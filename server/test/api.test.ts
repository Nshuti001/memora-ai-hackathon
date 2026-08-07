import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { databaseAvailable, ensureSchema, freshTenant, shutdown } from './helpers.js';
import { handleRequest, type ApiRequest, type ApiResponse } from '../src/api.js';
import { checkRateLimit, record, resetMetrics, snapshot } from '../src/observability.js';
import { query } from '../src/db.js';

const available = await databaseAvailable();

after(async () => {
  await shutdown();
});

function request(
  method: string,
  path: string,
  options: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): ApiRequest {
  return {
    method,
    path,
    searchParams: new URLSearchParams(options.query ?? {}),
    body: options.body ?? null,
    headers: {},
  };
}

/** Narrows to the JSON variant, failing loudly if a route unexpectedly streamed. */
function jsonBody<T>(response: ApiResponse): T {
  assert.equal(response.kind, 'json', 'expected a JSON response');
  return (response as Extract<ApiResponse, { kind: 'json' }>).body as T;
}

describe('metrics', () => {
  beforeEach(() => resetMetrics());

  test('computes percentiles over recorded samples', () => {
    for (let i = 1; i <= 100; i++) record('demo', i);

    const { operations } = snapshot();
    assert.equal(operations.demo.count, 100);
    assert.equal(operations.demo.p50Ms, 50);
    assert.equal(operations.demo.p95Ms, 95);
    assert.equal(operations.demo.p99Ms, 99);
    assert.equal(operations.demo.maxMs, 100);
  });

  test('tracks the error rate separately from latency', () => {
    record('flaky', 10, false);
    record('flaky', 10, true);
    record('flaky', 10, true);

    const { operations } = snapshot();
    assert.equal(operations.flaky.errors, 2);
    assert.equal(operations.flaky.errorRate, 0.6667);
  });

  test('reports nothing rather than zero for an operation never seen', () => {
    assert.equal(snapshot().operations.never, undefined);
  });
});

describe('rate limiting', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('allows requests up to the limit, then blocks', async () => {
    const tenantId = freshTenant();

    try {
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(await checkRateLimit({ tenantId, limit: 3, windowSeconds: 60 }));
      }

      assert.deepEqual(
        results.map((r) => r.allowed),
        [true, true, true, false, false],
        'the fourth request in a limit-3 window must be rejected',
      );
      assert.equal(results[0].remaining, 2);
      assert.equal(results[2].remaining, 0);
    } finally {
      await query('DELETE FROM rate_limits WHERE key LIKE $1', [`${tenantId}%`]);
    }
  });

  test('counts each tenant independently', async () => {
    const alice = freshTenant();
    const bob = freshTenant();

    try {
      await checkRateLimit({ tenantId: alice, limit: 1, windowSeconds: 60 });
      const aliceSecond = await checkRateLimit({ tenantId: alice, limit: 1, windowSeconds: 60 });
      const bobFirst = await checkRateLimit({ tenantId: bob, limit: 1, windowSeconds: 60 });

      assert.equal(aliceSecond.allowed, false, 'alice is over her limit');
      assert.equal(bobFirst.allowed, true, "bob's quota is untouched by alice");
    } finally {
      await query('DELETE FROM rate_limits WHERE key LIKE $1 OR key LIKE $2', [
        `${alice}%`,
        `${bob}%`,
      ]);
    }
  });

  test('a limit of zero disables throttling entirely', async () => {
    const result = await checkRateLimit({ tenantId: freshTenant(), limit: 0 });
    assert.equal(result.allowed, true);
  });
});

describe('api routes', { skip: available ? false : 'no CockroachDB reachable' }, () => {
  before(async () => {
    await ensureSchema();
  });

  test('health reports database reachability without requiring auth', async () => {
    const response = await handleRequest(request('GET', '/api/health'));
    const body = jsonBody<{ ok: boolean; databaseLatencyMs: number }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(typeof body.databaseLatencyMs === 'number');
  });

  test('unknown routes 404 rather than 500', async () => {
    const response = await handleRequest(request('GET', '/api/nope'));
    assert.equal(response.status, 404);
  });

  test('writing then searching a memory round-trips through the API', async () => {
    const created = await handleRequest(
      request('POST', '/api/memories', {
        body: { content: 'The invoicing service is written in Rust', kind: 'semantic' },
      }),
    );
    assert.equal(created.status, 201);

    const found = await handleRequest(
      request('GET', '/api/search', { query: { q: 'invoicing service Rust' } }),
    );
    const body = jsonBody<{ results: unknown[]; latencyMs: number }>(found);

    assert.equal(found.status, 200);
    assert.ok(body.results.length >= 1);
    assert.ok(typeof body.latencyMs === 'number');
  });

  test('rejects a memory with no content', async () => {
    const response = await handleRequest(request('POST', '/api/memories', { body: { content: '  ' } }));
    assert.equal(response.status, 400);
  });

  test('rejects an oversized memory instead of truncating it', async () => {
    const response = await handleRequest(
      request('POST', '/api/memories', { body: { content: 'x'.repeat(9000) } }),
    );
    assert.equal(response.status, 413);
  });

  test('search requires a query', async () => {
    const response = await handleRequest(request('GET', '/api/search'));
    assert.equal(response.status, 400);
  });

  test('time travel rejects a malformed timestamp with 400, not 500', async () => {
    const response = await handleRequest(
      request('GET', '/api/time-travel', { query: { q: 'anything', at: "'; DROP TABLE memories; --" } }),
    );
    const body = jsonBody<{ error: string }>(response);

    assert.equal(response.status, 400, 'a bad timestamp is a client error');
    assert.match(body.error, /Unrecognized timestamp/);
  });

  test('time travel requires both a query and a timestamp', async () => {
    assert.equal((await handleRequest(request('GET', '/api/time-travel', { query: { q: 'x' } }))).status, 400);
    assert.equal((await handleRequest(request('GET', '/api/time-travel', { query: { at: '-1h' } }))).status, 400);
  });

  test('caps an oversized limit rather than honouring it', async () => {
    const response = await handleRequest(
      request('GET', '/api/memories', { query: { limit: '100000' } }),
    );
    assert.equal(response.status, 200, 'an absurd limit is clamped, not rejected');
  });

  test('reports the retention window time travel can actually reach', async () => {
    const response = await handleRequest(request('GET', '/api/retention'));
    const body = jsonBody<{ seconds: number }>(response);

    assert.equal(response.status, 200);
    assert.ok(body.seconds >= 3600, 'the window should be at least an hour');
  });

  test('metrics expose per-operation latency', async () => {
    resetMetrics();
    record('http.demo', 42);

    const response = await handleRequest(request('GET', '/api/metrics'));
    const body = jsonBody<{
      uptimeSeconds: number;
      operations: Record<string, { count: number }>;
    }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.operations['http.demo'].count, 1);
    assert.ok(typeof body.uptimeSeconds === 'number');
  });

  test('the streaming chat route returns a stream, not JSON', async () => {
    const response = await handleRequest(
      request('POST', '/api/chat/stream', { body: { message: 'hello' } }),
    );
    assert.equal(response.kind, 'stream', 'the SSE route must not buffer into JSON');
  });
});
