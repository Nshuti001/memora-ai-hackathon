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
import { graph, listMemories, recall, remember, stats, supersede } from '../src/memory.js';
import { query } from '../src/db.js';

const available = await databaseAvailable();

describe('memory layer', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  after(async () => {
    await shutdown();
  });

  test('stores a memory and recalls it by meaning', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({
        tenantId,
        agentId,
        content: 'The user deploys to production on Fridays',
        kind: 'semantic',
        importance: 0.8,
      });

      const hits = await recall({ tenantId, agentId, query: 'deploys production Fridays' });

      assert.equal(hits.length, 1);
      assert.match(hits[0].content, /Fridays/);
      assert.ok(hits[0].score > 0, 'a matching memory should score above zero');
      assert.ok(hits[0].distance >= 0, 'distance should be non-negative');
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('reinforces a near-duplicate instead of inserting a second row', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const first = await remember({
        tenantId,
        agentId,
        content: 'The user prefers dark mode interfaces',
        importance: 0.5,
      });
      assert.equal(first.deduplicated, false);

      const second = await remember({
        tenantId,
        agentId,
        content: 'The user prefers dark mode interfaces',
        importance: 0.5,
      });

      assert.equal(second.deduplicated, true, 'an identical restatement must deduplicate');
      assert.equal(second.memory.id, first.memory.id, 'it should reinforce the same row');
      assert.ok(
        Number(second.memory.importance) > Number(first.memory.importance),
        'reinforcement should raise importance',
      );

      const all = await listMemories({ tenantId, agentId });
      assert.equal(all.length, 1, 'the store should still hold exactly one memory');
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('keeps a genuinely different fact as its own memory', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({ tenantId, agentId, content: 'The user prefers dark mode interfaces' });
      const second = await remember({
        tenantId,
        agentId,
        content: 'Quarterly revenue grew fastest in the Nordic region',
      });

      assert.equal(second.deduplicated, false);
      assert.equal((await listMemories({ tenantId, agentId })).length, 2);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('one tenant can never recall another tenant\'s memories', async () => {
    const alice = freshTenant();
    const bob = freshTenant();
    const aliceAgent = await createAgent(alice);
    const bobAgent = await createAgent(bob);

    try {
      await remember({
        tenantId: alice,
        agentId: aliceAgent,
        content: 'Alice private launch codes are stored in the vault',
      });

      const bobHits = await recall({
        tenantId: bob,
        agentId: bobAgent,
        query: 'Alice private launch codes vault',
      });

      assert.equal(bobHits.length, 0, 'cross-tenant recall must return nothing');
    } finally {
      await cleanupTenant(alice);
      await cleanupTenant(bob);
    }
  });

  test('one agent does not see a sibling agent\'s unshared memories', async () => {
    const tenantId = freshTenant();
    const first = await createAgent(tenantId, 'agent-one');
    const second = await createAgent(tenantId, 'agent-two');

    try {
      await remember({ tenantId, agentId: first, content: 'Private note about the billing rewrite' });

      const unshared = await recall({
        tenantId,
        agentId: second,
        query: 'billing rewrite note',
      });
      assert.equal(unshared.length, 0, 'unshared memories stay with their agent');
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('a shared memory is recallable by a sibling agent', async () => {
    const tenantId = freshTenant();
    const first = await createAgent(tenantId, 'agent-one');
    const second = await createAgent(tenantId, 'agent-two');

    try {
      await remember({
        tenantId,
        agentId: first,
        content: 'The staging database credentials rotate every Monday',
        shared: true,
      });

      const shared = await recall({
        tenantId,
        agentId: second,
        query: 'staging database credentials rotate Monday',
        includeShared: true,
      });

      assert.equal(shared.length, 1, 'shared memories cross agent boundaries within a tenant');
      assert.match(shared[0].content, /rotate every Monday/);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('a correction hides the old belief but keeps it on record', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const original = await remember({
        tenantId,
        agentId,
        content: 'The team uses Jenkins for continuous integration',
        kind: 'semantic',
      });

      await supersede({
        tenantId,
        agentId,
        oldId: original.memory.id,
        content: 'The team migrated from Jenkins to GitHub Actions for continuous integration',
      });

      const live = await listMemories({ tenantId, agentId });
      const liveIds = live.map((m) => m.id);
      assert.ok(!liveIds.includes(original.memory.id), 'the superseded memory must leave recall');

      const [stored] = await query<{ superseded_by: string | null; confidence: string }>(
        'SELECT superseded_by, confidence FROM memories WHERE id = $1',
        [original.memory.id],
      );
      assert.ok(stored.superseded_by, 'the row survives with a pointer to its replacement');
      assert.ok(Number(stored.confidence) < 1, 'confidence drops rather than the row being deleted');

      const links = await query<{ relation: string }>(
        'SELECT relation FROM memory_links WHERE tenant_id = $1 AND dst_id = $2',
        [tenantId, original.memory.id],
      );
      assert.equal(links[0]?.relation, 'supersedes');
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('recall is filterable by memory kind', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({ tenantId, agentId, content: 'Deployed the billing service on Tuesday', kind: 'episodic' });
      await remember({ tenantId, agentId, content: 'Billing service runs on three replicas', kind: 'semantic' });

      const semantic = await recall({
        tenantId,
        agentId,
        query: 'billing service',
        kinds: ['semantic'],
      });

      assert.ok(semantic.length >= 1);
      assert.ok(semantic.every((m) => m.kind === 'semantic'), 'kind filter must be honoured');
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('stats count each memory kind separately', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({ tenantId, agentId, content: 'Shipped the search rewrite', kind: 'episodic' });
      await remember({ tenantId, agentId, content: 'Search runs on OpenSearch clusters', kind: 'semantic' });
      await remember({ tenantId, agentId, content: 'To reindex, drain traffic then run the backfill', kind: 'procedural' });

      const summary = await stats({ tenantId, agentId });

      assert.equal(summary.total, 3);
      assert.equal(summary.episodic, 1);
      assert.equal(summary.semantic, 1);
      assert.equal(summary.procedural, 1);
      assert.ok(summary.avgImportance !== null);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('the graph links a correction to what it replaced', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const original = await remember({
        tenantId,
        agentId,
        content: 'Retention is set to thirty days',
        kind: 'semantic',
      });
      await supersede({
        tenantId,
        agentId,
        oldId: original.memory.id,
        content: 'Retention was raised to ninety days',
      });

      const { edges } = await graph({ tenantId, agentId, includeSimilar: false });
      assert.ok(
        edges.some((e) => e.relation === 'supersedes' && e.dst_id === original.memory.id),
        'the supersession edge should appear in the graph',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('every recall and write lands in the audit log', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({ tenantId, agentId, content: 'Audit trail smoke test memory' });
      await recall({ tenantId, agentId, query: 'audit trail smoke test' });

      // The recall audit row is written fire-and-forget so it never delays the agent; give it a beat.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const entries = await query<{ operation: string }>(
        'SELECT operation FROM memory_audit WHERE tenant_id = $1',
        [tenantId],
      );
      const operations = entries.map((e) => e.operation);

      assert.ok(operations.includes('remember'), 'writes are audited');
      assert.ok(operations.includes('recall'), 'reads are audited');
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
