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
import { embeddingHealth, listMemories, recall, remember } from '../src/memory.js';
import { activeEmbeddingModel, LOCAL_MODEL_ID, embed } from '../src/embeddings.js';
import { query } from '../src/db.js';

const available = await databaseAvailable();

after(async () => {
  await shutdown();
});

describe('active embedding model', () => {
  test('reports the local id when the local provider is configured', () => {
    // The suite runs with EMBEDDING_PROVIDER=local (see .env.test).
    assert.equal(activeEmbeddingModel(), LOCAL_MODEL_ID);
  });

  test('tags every vector with the model that produced it', async () => {
    const { vector, model } = await embed('a sentence to embed');
    assert.equal(model, LOCAL_MODEL_ID, 'the model must travel with the vector');
    assert.equal(vector.length, 1024);
  });
});

describe('embedding provenance', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('stores the model that produced each memory', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const { memory } = await remember({
        tenantId,
        agentId,
        content: 'The billing service reconciles nightly',
        kind: 'semantic',
      });

      const [row] = await query<{ embedding_model: string }>(
        'SELECT embedding_model FROM memories WHERE id = $1',
        [memory.id],
      );
      assert.equal(row.embedding_model, LOCAL_MODEL_ID);
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  /**
   * The invariant this whole feature exists for. Two models produce points in unrelated spaces, so
   * comparing across them returns noise rather than an error — the failure is silent, which is why
   * it has to be prevented in the query rather than caught at runtime.
   */
  test('never recalls a memory embedded by a different model', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const { memory } = await remember({
        tenantId,
        agentId,
        content: 'Deployments are frozen during the end-of-quarter close',
        kind: 'semantic',
      });

      // Findable while it is in the active model's space.
      const before = await recall({ tenantId, agentId, query: 'deployment freeze quarter close' });
      assert.ok(
        before.some((m) => m.id === memory.id),
        'precondition: the memory should be recallable before the model changes',
      );

      // Simulate the real failure — a throttle sent the writer to a different provider.
      await query('UPDATE memories SET embedding_model = $1 WHERE id = $2', [
        'some-other-model-v9',
        memory.id,
      ]);

      const after = await recall({ tenantId, agentId, query: 'deployment freeze quarter close' });
      assert.ok(
        !after.some((m) => m.id === memory.id),
        'a memory from another vector space must not be compared against the active model',
      );

      // It is hidden from recall, not lost.
      const listed = await listMemories({ tenantId, agentId });
      assert.ok(
        listed.some((m) => m.id === memory.id),
        'the row still exists and is still listed — only vector search excludes it',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('reports how many memories the active model cannot search', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({ tenantId, agentId, content: 'A memory in the current space', kind: 'semantic' });
      const stray = await remember({ tenantId, agentId, content: 'A memory from an older model', kind: 'semantic' });

      await query('UPDATE memories SET embedding_model = $1 WHERE id = $2', [
        'legacy-model-v0',
        stray.memory.id,
      ]);

      const health = await embeddingHealth({ tenantId, agentId });

      assert.equal(health.activeModel, LOCAL_MODEL_ID);
      assert.equal(health.unsearchable, 1, 'exactly one memory sits in a foreign space');
      assert.ok(
        health.byModel.some((r) => r.model === 'legacy-model-v0' && r.count === 1),
        'the foreign model should be named in the breakdown',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('deduplication does not merge across models', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const first = await remember({
        tenantId,
        agentId,
        content: 'Identical text used to probe deduplication',
        kind: 'semantic',
      });

      await query('UPDATE memories SET embedding_model = $1 WHERE id = $2', [
        'some-other-model-v9',
        first.memory.id,
      ]);

      // The same sentence again. The near-duplicate probe must not match the foreign-space row,
      // because their distance is meaningless — merging on it would corrupt the surviving memory.
      const second = await remember({
        tenantId,
        agentId,
        content: 'Identical text used to probe deduplication',
        kind: 'semantic',
      });

      assert.equal(second.deduplicated, false, 'must not deduplicate against another vector space');
      assert.notEqual(second.memory.id, first.memory.id);
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});

describe('embedding cache', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('is keyed by model as well as text', async () => {
    const sha = 'a'.repeat(64);
    const vec = `[${new Array(1024).fill(0.01).join(',')}]`;

    try {
      await query(
        `INSERT INTO embedding_cache (model, text_sha256, embedding) VALUES ($1, $2, $3)`,
        ['model-a', sha, vec],
      );
      // Same text, different model — must coexist, or a cache hit would serve a vector from the
      // wrong space.
      await query(
        `INSERT INTO embedding_cache (model, text_sha256, embedding) VALUES ($1, $2, $3)`,
        ['model-b', sha, vec],
      );

      const rows = await query<{ model: string }>(
        'SELECT model FROM embedding_cache WHERE text_sha256 = $1 ORDER BY model',
        [sha],
      );
      assert.deepEqual(rows.map((r) => r.model), ['model-a', 'model-b']);
    } finally {
      await query('DELETE FROM embedding_cache WHERE text_sha256 = $1', [sha]);
    }
  });

  test('re-inserting the same (model, text) is a no-op rather than an error', async () => {
    const sha = 'b'.repeat(64);
    const vec = `[${new Array(1024).fill(0.02).join(',')}]`;

    try {
      await query(`INSERT INTO embedding_cache (model, text_sha256, embedding) VALUES ($1,$2,$3)`, [
        'model-a', sha, vec,
      ]);
      await query(
        `INSERT INTO embedding_cache (model, text_sha256, embedding) VALUES ($1,$2,$3)
         ON CONFLICT (model, text_sha256) DO NOTHING`,
        ['model-a', sha, vec],
      );

      const [row] = await query<{ count: string }>(
        'SELECT count(*) AS count FROM embedding_cache WHERE text_sha256 = $1',
        [sha],
      );
      assert.equal(Number(row.count), 1);
    } finally {
      await query('DELETE FROM embedding_cache WHERE text_sha256 = $1', [sha]);
    }
  });
});
