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
import { asOfClause, beliefDiff, InvalidTimestampError, provenance, recallAsOf } from '../src/time-travel.js';
import { remember, supersede } from '../src/memory.js';
import { query } from '../src/db.js';

describe('asOfClause', () => {
  test('accepts past relative intervals', () => {
    assert.equal(asOfClause('-1h'), "'-1h'");
    assert.equal(asOfClause('-30m'), "'-30m'");
    assert.equal(asOfClause('-7d'), "'-7d'");
  });

  test('accepts follower reads', () => {
    assert.equal(asOfClause('follower'), 'follower_read_timestamp()');
  });

  test('normalizes an ISO instant', () => {
    assert.equal(asOfClause('2020-01-02T03:04:05Z'), "'2020-01-02T03:04:05.000Z'");
  });

  test('rejects a future timestamp', () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    assert.throws(() => asOfClause(tomorrow), InvalidTimestampError);
  });

  // CockroachDB will not accept a bound parameter after AS OF SYSTEM TIME, so the clause is
  // interpolated into the SQL text. This validator is the only barrier — these must never pass.
  const injections = [
    "'; DROP TABLE memories; --",
    "-1h' OR '1'='1",
    '2026-01-01T00:00:00Z; DELETE FROM memories',
    "follower_read_timestamp()); DROP TABLE agents; --",
    '1h', // no leading minus: would read the future
    '+1h',
    '',
    '   ',
    'now()',
    'cluster_logical_timestamp()',
  ];

  for (const attempt of injections) {
    test(`rejects ${JSON.stringify(attempt)}`, () => {
      assert.throws(() => asOfClause(attempt), InvalidTimestampError);
    });
  }
});

const available = await databaseAvailable();

describe('time travel', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  after(async () => {
    await shutdown();
  });

  test('reads the memory store as it was before a fact existed', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      await remember({
        tenantId,
        agentId,
        content: 'The project uses PostgreSQL for its primary datastore',
        kind: 'semantic',
      });

      // Take the timestamp from the cluster, not from the Node process — comparing a locally
      // generated clock against the database's would make this test flaky under any clock skew.
      const [{ ts }] = await query<{ ts: string }>('SELECT now()::STRING AS ts');
      await new Promise((resolve) => setTimeout(resolve, 250));

      await remember({
        tenantId,
        agentId,
        content: 'The analytics pipeline runs nightly at two in the morning',
        kind: 'semantic',
      });

      const past = await recallAsOf({
        tenantId,
        agentId,
        query: 'analytics pipeline nightly',
        at: new Date(ts),
        limit: 5,
      });

      assert.ok(
        !past.some((m) => /analytics pipeline/.test(m.content)),
        'a memory written after the timestamp must not appear in a read of the past',
      );

      const present = await recallAsOf({
        tenantId,
        agentId,
        query: 'analytics pipeline nightly',
        at: '-1us',
        limit: 5,
      });

      assert.ok(
        present.some((m) => /analytics pipeline/.test(m.content)),
        'the same query against the present must find it',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('a belief diff separates what was learned from what changed', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const original = await remember({
        tenantId,
        agentId,
        content: 'Deployment happens manually every Friday afternoon',
        kind: 'semantic',
      });

      const [{ ts }] = await query<{ ts: string }>('SELECT now()::STRING AS ts');
      await new Promise((resolve) => setTimeout(resolve, 250));

      await supersede({
        tenantId,
        agentId,
        oldId: original.memory.id,
        content: 'Deployment happens automatically on every merge to main',
      });

      const diff = await beliefDiff({
        tenantId,
        agentId,
        query: 'deployment schedule',
        at: new Date(ts),
      });

      assert.ok(
        diff.changed.some((m) => m.id === original.memory.id),
        'the superseded belief should show up as changed',
      );
      assert.ok(
        diff.learned.some((m) => /automatically on every merge/.test(m.content)),
        'the replacement should show up as learned',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });

  test('provenance walks the supersession chain back to the original belief', async () => {
    const tenantId = freshTenant();
    const agentId = await createAgent(tenantId);

    try {
      const first = await remember({
        tenantId,
        agentId,
        content: 'Cache entries expire after sixty seconds',
        kind: 'semantic',
      });

      const second = await supersede({
        tenantId,
        agentId,
        oldId: first.memory.id,
        content: 'Cache entries expire after five minutes',
      });

      const third = await supersede({
        tenantId,
        agentId,
        oldId: second.id,
        content: 'Cache entries expire after one hour',
      });

      const chain = await provenance({ tenantId, memoryId: third.id });

      assert.ok(chain.length >= 3, `expected a chain of at least 3, got ${chain.length}`);
      assert.equal(chain[0].id, third.id, 'the chain starts at the current belief');
      assert.ok(
        chain.some((step) => step.id === first.memory.id),
        'the chain reaches the original belief',
      );
    } finally {
      await cleanupTenant(tenantId);
    }
  });
});
