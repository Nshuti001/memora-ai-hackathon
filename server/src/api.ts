import { query } from './db.js';
import { config } from './config.js';
import { runTurn, streamTurn, type AgentEvent } from './agent.js';
import { consolidate, decay, reinstate } from './consolidation.js';
import {
  embeddingHealth,
  graph,
  listMemories,
  recall,
  recentAudit,
  remember,
  stats,
  supersede,
} from './memory.js';
import {
  beliefDiff,
  InvalidTimestampError,
  provenance,
  recallAsOf,
  retentionWindowSeconds,
} from './time-travel.js';
import { checkRateLimit, record, snapshot, timed } from './observability.js';

export interface ApiRequest {
  method: string;
  path: string;
  searchParams: URLSearchParams;
  body: Record<string, unknown> | null;
  headers: Record<string, string | undefined>;
}

export type ApiResponse =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'stream'; status: number; events: AsyncGenerator<AgentEvent> };

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown, headers?: Record<string, string>): ApiResponse {
  return { kind: 'json', status, body, headers };
}

/**
 * Every request is scoped to a tenant. The tenant comes from the API key, never from the request
 * body — taking it from the body would let any client read any other client's memories by guessing
 * an id, which is the single most damaging bug this service could have.
 */
function tenantOf(headers: ApiRequest['headers']): string {
  const configured = process.env.MEMORA_API_KEYS;
  const presented = headers['x-api-key'];

  if (!configured) return 'demo';

  const table = new Map(
    configured.split(',').map((pair) => {
      const [key, tenant] = pair.split(':');
      return [key.trim(), (tenant ?? 'demo').trim()];
    }),
  );

  const tenant = presented ? table.get(presented) : undefined;
  if (!tenant) throw new HttpError(401, 'Missing or invalid x-api-key');
  return tenant;
}

/** Resolves the named agent for this tenant, creating it on first use. */
async function agentIdFor(tenantId: string, name: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO agents (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = excluded.name
       RETURNING id`,
    [tenantId, name],
  );
  return row.id;
}

function str(value: unknown, field: string, max = 8000): string {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, `${field} is required`);
  if (text.length > max) throw new HttpError(413, `${field} exceeds ${max} characters`);
  return text;
}

function num(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function handleRequest(req: ApiRequest): Promise<ApiResponse> {
  const started = Date.now();
  const label = `http.${req.method} ${req.path}`;

  try {
    const response = await route(req);
    // Streaming responses have barely begun at this point — the generator has not been consumed —
    // so timing them here would record the setup cost, not the turn. The agent records its own
    // `agent.turn` metric instead.
    if (response.kind !== 'stream') {
      record(label, Date.now() - started, response.status >= 500);
    }
    return response;
  } catch (err) {
    record(label, Date.now() - started, true);

    if (err instanceof InvalidTimestampError) {
      return json(400, { error: err.message });
    }
    if (err instanceof HttpError) {
      return json(err.status, { error: err.message });
    }
    console.error('[api] unhandled error', err);
    // Never leak internals — pg errors embed the connection string.
    return json(500, { error: 'Internal error' });
  }
}

async function route(req: ApiRequest): Promise<ApiResponse> {
  // Health must not require auth or a rate-limit slot: it is what a load balancer polls, and a
  // health check that can be throttled will take the service out of rotation under load.
  if (req.method === 'GET' && req.path === '/api/health') {
    const started = Date.now();
    await query('SELECT 1');
    return json(200, {
      ok: true,
      model: config.modelId,
      region: config.awsRegion,
      embeddingProvider: config.embeddingProvider,
      awsCredentialsConfigured: Boolean(config.awsAccessKeyId && config.awsSecretAccessKey),
      databaseLatencyMs: Date.now() - started,
    });
  }

  if (req.method === 'GET' && req.path === '/api/metrics') {
    return json(200, snapshot());
  }

  const tenantId = tenantOf(req.headers);

  const limit = await checkRateLimit({ tenantId });
  if (!limit.allowed) {
    return json(
      429,
      { error: `Rate limit of ${limit.limit} requests/minute exceeded`, retryAfter: limit.resetSeconds },
      {
        'retry-after': String(limit.resetSeconds),
        'x-ratelimit-limit': String(limit.limit),
        'x-ratelimit-remaining': '0',
      },
    );
  }

  const rateHeaders = {
    'x-ratelimit-limit': String(limit.limit),
    'x-ratelimit-remaining': String(limit.remaining),
  };

  const agentName = req.searchParams.get('agent') ?? String(req.body?.agent ?? 'memora');
  const agentId = await agentIdFor(tenantId, agentName);

  // -------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------

  if (req.method === 'POST' && req.path === '/api/chat') {
    const message = str(req.body?.message, 'message');
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as { role: 'user' | 'assistant'; content: string }[]).slice(-10)
      : [];

    const turn = await runTurn({ tenantId, agentId, message, history });
    return json(200, turn, rateHeaders);
  }

  if (req.method === 'POST' && req.path === '/api/chat/stream') {
    const message = str(req.body?.message, 'message');
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as { role: 'user' | 'assistant'; content: string }[]).slice(-10)
      : [];

    return { kind: 'stream', status: 200, events: streamTurn({ tenantId, agentId, message, history }) };
  }

  // -------------------------------------------------------------------------
  // Memories
  // -------------------------------------------------------------------------

  if (req.method === 'GET' && req.path === '/api/memories') {
    const memories = await listMemories({
      tenantId,
      agentId,
      limit: num(req.searchParams.get('limit'), 50, 200),
    });
    return json(200, { memories }, rateHeaders);
  }

  if (req.method === 'POST' && req.path === '/api/memories') {
    const result = await remember({
      tenantId,
      agentId,
      content: str(req.body?.content, 'content'),
      kind: (req.body?.kind as 'episodic' | 'semantic' | 'procedural') ?? 'semantic',
      importance: typeof req.body?.importance === 'number' ? req.body.importance : 0.5,
      tags: Array.isArray(req.body?.tags) ? (req.body.tags as string[]) : [],
      shared: req.body?.shared === true,
    });
    return json(201, result, rateHeaders);
  }

  if (req.method === 'POST' && req.path === '/api/memories/correct') {
    const memory = await supersede({
      tenantId,
      agentId,
      oldId: str(req.body?.memoryId, 'memoryId', 64),
      content: str(req.body?.content, 'content'),
    });
    return json(200, { memory }, rateHeaders);
  }

  if (req.method === 'POST' && req.path === '/api/memories/reinstate') {
    const restored = await reinstate({
      tenantId,
      memoryId: str(req.body?.memoryId, 'memoryId', 64),
    });
    return json(restored ? 200 : 404, { restored }, rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/search') {
    const q = req.searchParams.get('q');
    if (!q) throw new HttpError(400, 'q is required');

    const started = Date.now();
    const results = await recall({
      tenantId,
      agentId,
      query: q,
      limit: num(req.searchParams.get('limit'), 8, 50),
      includeShared: req.searchParams.get('shared') !== 'false',
    });
    return json(200, { results, latencyMs: Date.now() - started }, rateHeaders);
  }

  // -------------------------------------------------------------------------
  // Time travel
  // -------------------------------------------------------------------------

  if (req.method === 'GET' && req.path === '/api/time-travel') {
    const q = req.searchParams.get('q');
    const at = req.searchParams.get('at');
    if (!q) throw new HttpError(400, 'q is required');
    if (!at) throw new HttpError(400, 'at is required (e.g. -2h, or an ISO timestamp)');

    const started = Date.now();
    const results = await recallAsOf({
      tenantId,
      agentId,
      query: q,
      at,
      limit: num(req.searchParams.get('limit'), 8, 50),
    });
    return json(200, { at, results, latencyMs: Date.now() - started }, rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/belief-diff') {
    const q = req.searchParams.get('q');
    const at = req.searchParams.get('at');
    if (!q) throw new HttpError(400, 'q is required');
    if (!at) throw new HttpError(400, 'at is required (e.g. -2h, or an ISO timestamp)');

    return json(200, await beliefDiff({ tenantId, agentId, query: q, at }), rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/provenance') {
    const memoryId = req.searchParams.get('memoryId');
    if (!memoryId) throw new HttpError(400, 'memoryId is required');

    return json(200, { chain: await provenance({ tenantId, memoryId }) }, rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/retention') {
    const seconds = await retentionWindowSeconds();
    return json(200, { seconds, humanized: `${Math.round(seconds / 3600)}h` }, rateHeaders);
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  if (req.method === 'POST' && req.path === '/api/consolidate') {
    const result = await timed('memory.consolidate', () =>
      consolidate({ tenantId, agentId, maxClusters: 5 }),
    );
    return json(200, result, rateHeaders);
  }

  if (req.method === 'POST' && req.path === '/api/decay') {
    const intensity = typeof req.body?.intensity === 'number' ? req.body.intensity : 1;
    const result = await timed('memory.decay', () => decay({ tenantId, agentId, intensity }));
    return json(200, result, rateHeaders);
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  if (req.method === 'GET' && req.path === '/api/graph') {
    const result = await graph({
      tenantId,
      agentId,
      limit: num(req.searchParams.get('limit'), 40, 150),
      includeSimilar: req.searchParams.get('similar') !== 'false',
    });
    return json(200, result, rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/stats') {
    // Embedding health rides along with stats because the dashboard already polls this, and a
    // vector-space mismatch is exactly the kind of silent fault that needs to be impossible to miss.
    const [summary, embeddings] = await Promise.all([
      stats({ tenantId, agentId }),
      embeddingHealth({ tenantId, agentId }),
    ]);
    return json(200, { ...summary, embeddings }, rateHeaders);
  }

  if (req.method === 'GET' && req.path === '/api/audit') {
    const entries = await recentAudit({
      tenantId,
      limit: num(req.searchParams.get('limit'), 25, 100),
    });
    return json(200, { entries }, rateHeaders);
  }

  return json(404, { error: `No route for ${req.method} ${req.path}` });
}
