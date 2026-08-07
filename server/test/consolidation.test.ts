import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupTenant,
  createAgent,
  databaseAvailable,
  ensureSchema,
  freshTenant,
  shutdown,
} from './helpers.js';
import { consolidate, decay, findClusters, reinstate } from '../src/consolidation.js';
import { listMemories, recall, remember, stats } from '../src/memory.js';
import { query } from '../src/db.js';

const available = await databaseAvailable();

// The pool is shared by every describe block in this file, so it is closed once here at file scope
// rather than in each block's `after` — closing it inside one block would leave the next block
// querying a dead pool.
after(async () => {
  await shutdown();
});

describe('consolidation', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  /** Writes episodes that all talk about the same thing, so they cluster. */
  async function seedRelatedEpisodes(tenantId: string, agentId: string) {
    const episodes = [
      'User asked about migrating the REST endpoints to GraphQL this morning',
      'User asked whether GraphQL migration should cover the auth endpoints first',
      'User asked how long the GraphQL endpoints migration would take overall',
      'User asked about GraphQL migration risk for the auth endpoints again',
    ];
    for (const content of episodes) {
      await remember({ tenantId, agentId, content, kind: 'episodic', importance: 0.5 });
    }
  }

  test('groups semantically adjacent episodes into a cluster', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await seedRelatedEpisodes(tenantId, agentId);
      await remember({
        tenantId,
        agentId,
        content: 'Nordic revenue grew twelve percent last quarter',
        kind: 'episodic',
      });

      const clusters = await findClusters({ tenantId, agentId });

      assert.ok(clusters.length >= 1, 'related episodes should form at least one cluster');
      assert.ok(
        clusters[0].members.length >= 3,
        `a cluster needs at least 3 members, got ${clusters[0].members.length}`,
      );
      assert.ok(
        clusters[0].members.every((m) => /GraphQL|migration|endpoints/i.test(m.content)),
        'the unrelated revenue episode must not be pulled into the migration cluster',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('distills a cluster into a semantic memory linked to its evidence', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await seedRelatedEpisodes(tenantId, agentId);

      const result = await consolidate({ tenantId, agentId });

      assert.ok(result.memoriesCreated.length >= 1, 'consolidation should produce a memory');
      assert.ok(result.sourcesConsolidated >= 3, 'it should consume at least the cluster');

      const created = result.memoriesCreated[0];

      const [semantic] = await query<{ kind: string; consolidated_at: string | null }>(
        'SELECT kind, consolidated_at FROM memories WHERE id = $1',
        [created.id],
      );
      assert.equal(semantic.kind, 'semantic', 'a generalization is semantic, not episodic');
      assert.ok(semantic.consolidated_at, 'it is stamped as consolidated');

      const links = await query<{ relation: string; dst_id: string }>(
        'SELECT relation, dst_id FROM memory_links WHERE tenant_id = $1 AND src_id = $2',
        [tenantId, created.id],
      );
      assert.equal(links.length, created.sourceCount, 'one derived_from edge per source episode');
      assert.ok(links.every((l) => l.relation === 'derived_from'));
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('keeps the source episodes rather than deleting them', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await seedRelatedEpisodes(tenantId, agentId);
      const before = await listMemories({ tenantId, agentId, limit: 100 });

      await consolidate({ tenantId, agentId });

      const after = await listMemories({ tenantId, agentId, limit: 100 });
      assert.ok(
        after.length > before.length,
        'consolidation adds a generalization without removing the evidence',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('does not consolidate the same episodes twice', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await seedRelatedEpisodes(tenantId, agentId);

      const first = await consolidate({ tenantId, agentId });
      const second = await consolidate({ tenantId, agentId });

      assert.ok(first.memoriesCreated.length >= 1);
      assert.equal(
        second.memoriesCreated.length,
        0,
        'a second pass over already-consolidated episodes must be a no-op',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('leaves an isolated memory alone', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({
        tenantId,
        agentId,
        content: 'A single unrelated observation about the office coffee machine',
        kind: 'episodic',
      });

      const result = await consolidate({ tenantId, agentId });
      assert.equal(result.memoriesCreated.length, 0, 'one episode is not a pattern');
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});

describe('decay', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('lowers importance of stale, never-accessed memories', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const { memory } = await remember({
        tenantId,
        agentId,
        content: 'An incidental detail nobody ever asks about',
        kind: 'episodic',
        importance: 0.6,
      });

      // Backdate so the memory qualifies as stale without the test sleeping for a day.
      await query(
        `UPDATE memories SET created_at = now() - INTERVAL '10 days',
                             last_accessed_at = now() - INTERVAL '10 days'
          WHERE id = $1`,
        [memory.id],
      );

      await decay({ tenantId, agentId });

      const [after] = await query<{ importance: string }>(
        'SELECT importance FROM memories WHERE id = $1',
        [memory.id],
      );
      assert.ok(
        Number(after.importance) < 0.6,
        `importance should fall from 0.6, got ${after.importance}`,
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('protects frequently recalled memories from decaying as fast', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const ignored = await remember({
        tenantId,
        agentId,
        content: 'Rarely relevant note about parking validation',
        kind: 'episodic',
        importance: 0.6,
      });
      const popular = await remember({
        tenantId,
        agentId,
        content: 'Critical detail about the payment reconciliation window',
        kind: 'episodic',
        importance: 0.6,
      });

      await query(
        `UPDATE memories SET created_at = now() - INTERVAL '10 days',
                             last_accessed_at = now() - INTERVAL '10 days'
          WHERE id = ANY($1::UUID[])`,
        [[ignored.memory.id, popular.memory.id]],
      );
      await query('UPDATE memories SET access_count = 50 WHERE id = $1', [popular.memory.id]);

      await decay({ tenantId, agentId });

      const rows = await query<{ id: string; importance: string }>(
        'SELECT id, importance FROM memories WHERE id = ANY($1::UUID[])',
        [[ignored.memory.id, popular.memory.id]],
      );
      const byId = new Map(rows.map((r) => [r.id, Number(r.importance)]));

      assert.ok(
        byId.get(popular.memory.id)! > byId.get(ignored.memory.id)!,
        'a memory recalled 50 times should decay more slowly than one never recalled',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('semantic memories decay more slowly than episodic ones', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const episodic = await remember({
        tenantId, agentId, kind: 'episodic', importance: 0.6,
        content: 'On Tuesday the user mentioned the billing rewrite in passing',
      });
      const semantic = await remember({
        tenantId, agentId, kind: 'semantic', importance: 0.6,
        content: 'Billing reconciliation runs against the ledger service',
      });

      await query(
        `UPDATE memories SET created_at = now() - INTERVAL '10 days',
                             last_accessed_at = now() - INTERVAL '10 days'
          WHERE id = ANY($1::UUID[])`,
        [[episodic.memory.id, semantic.memory.id]],
      );

      await decay({ tenantId, agentId });

      const rows = await query<{ id: string; importance: string }>(
        'SELECT id, importance FROM memories WHERE id = ANY($1::UUID[])',
        [[episodic.memory.id, semantic.memory.id]],
      );
      const byId = new Map(rows.map((r) => [r.id, Number(r.importance)]));

      assert.ok(
        byId.get(semantic.memory.id)! > byId.get(episodic.memory.id)!,
        'a durable fact should outlive the episodes that produced it',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('archives worthless memories out of recall, reversibly', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const { memory } = await remember({
        tenantId,
        agentId,
        content: 'Utterly forgettable observation about the weather',
        kind: 'episodic',
        importance: 0.1,
      });

      const result = await decay({ tenantId, agentId });
      assert.ok(result.archived >= 1, 'a memory below the floor should archive');

      const live = await recall({ tenantId, agentId, query: 'forgettable observation weather' });
      assert.ok(!live.some((m) => m.id === memory.id), 'archived memories leave recall');

      const summary = await stats({ tenantId, agentId });
      assert.ok(summary.archived >= 1, 'archived memories are still counted');

      assert.equal(await reinstate({ tenantId, memoryId: memory.id }), true);

      const restored = await recall({ tenantId, agentId, query: 'forgettable observation weather' });
      assert.ok(
        restored.some((m) => m.id === memory.id),
        'reinstating brings a memory back — decay must be reversible',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
