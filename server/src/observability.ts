/**
 * Metrics and rate limiting.
 *
 * Both are deliberately split by concern:
 *
 *   Metrics are in-process. They describe one Lambda execution environment, are free to record, and
 *   are exposed at /api/metrics for scraping. Aggregating them centrally is a job for CloudWatch, not
 *   for a request handler.
 *
 *   Rate limiting is in CockroachDB. An in-process limiter is worthless the moment you run more than
 *   one instance — every Lambda environment would grant the full quota independently, so N instances
 *   means N times the intended limit. A fixed-window counter in the database is shared by every
 *   instance and costs one upsert per request.
 */
import { query } from './db.js';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Latency metrics
// ---------------------------------------------------------------------------

interface Series {
  count: number;
  errors: number;
  totalMs: number;
  /** Retained newest-first, capped, so percentiles stay meaningful without unbounded memory. */
  samples: number[];
}

const SAMPLE_LIMIT = 1000;
const series = new Map<string, Series>();
const startedAt = Date.now();

export function record(operation: string, durationMs: number, failed = false): void {
  let entry = series.get(operation);
  if (!entry) {
    entry = { count: 0, errors: 0, totalMs: 0, samples: [] };
    series.set(operation, entry);
  }

  entry.count += 1;
  entry.totalMs += durationMs;
  if (failed) entry.errors += 1;

  entry.samples.push(durationMs);
  if (entry.samples.length > SAMPLE_LIMIT) entry.samples.shift();
}

/** Times a promise, recording the outcome under `operation` either way. */
export async function timed<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    record(operation, Date.now() - started, false);
    return result;
  } catch (err) {
    record(operation, Date.now() - started, true);
    throw err;
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  // Nearest-rank: the smallest value at or above the p-th position.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface OperationMetrics {
  count: number;
  errors: number;
  errorRate: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

export function snapshot(): {
  uptimeSeconds: number;
  operations: Record<string, OperationMetrics>;
} {
  const operations: Record<string, OperationMetrics> = {};

  for (const [name, entry] of series) {
    const sorted = [...entry.samples].sort((a, b) => a - b);
    operations[name] = {
      count: entry.count,
      errors: entry.errors,
      errorRate: entry.count ? Number((entry.errors / entry.count).toFixed(4)) : 0,
      meanMs: entry.count ? Math.round(entry.totalMs / entry.count) : null,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    operations,
  };
}

/** Test seam — metrics are process-global, so a suite needs a way back to a clean slate. */
export function resetMetrics(): void {
  series.clear();
}

// ---------------------------------------------------------------------------
// Distributed rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  resetSeconds: number;
}

/**
 * Fixed-window counter, shared across every instance via CockroachDB.
 *
 * A fixed window can admit up to 2x the limit across a window boundary — the classic trade against a
 * sliding log, which would need one row per request. For protecting an agent API from runaway loops
 * that is the right side of the trade: one upsert per request instead of one insert plus a range
 * scan.
 *
 * The counter is deliberately not wrapped in the caller's transaction. Rate limiting must not be
 * rolled back when the request it was protecting fails — otherwise a client in a crash loop gets
 * unlimited retries for free.
 */
export async function checkRateLimit(opts: {
  tenantId: string;
  bucket?: string;
  limit?: number;
  windowSeconds?: number;
}): Promise<RateLimitResult> {
  const limit = opts.limit ?? config.rateLimitPerMinute;
  const windowSeconds = opts.windowSeconds ?? 60;

  if (limit <= 0) {
    return { allowed: true, limit: 0, remaining: Number.MAX_SAFE_INTEGER, resetSeconds: 0 };
  }

  const key = `${opts.tenantId}:${opts.bucket ?? 'api'}`;
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;

  try {
    const [row] = await query<{ hits: string }>(
      `INSERT INTO rate_limits (key, window_start, hits)
            VALUES ($1, to_timestamp($2), 1)
       ON CONFLICT (key, window_start)
       DO UPDATE SET hits = rate_limits.hits + 1
         RETURNING hits`,
      [key, windowStart],
    );

    const hits = Number(row.hits);
    const elapsed = Date.now() / 1000 - windowStart;

    return {
      allowed: hits <= limit,
      limit,
      remaining: Math.max(0, limit - hits),
      resetSeconds: Math.max(0, Math.ceil(windowSeconds - elapsed)),
    };
  } catch (err) {
    // Fail open. A rate limiter that takes the API down when the counter is unavailable has
    // converted a throttling feature into an outage.
    console.error('[ratelimit] counter unavailable, allowing request', err);
    return { allowed: true, limit, remaining: limit, resetSeconds: windowSeconds };
  }
}

/** Drops counters for windows that have rolled over. Safe to call on any schedule. */
export async function pruneRateLimits(): Promise<number> {
  const rows = await query<{ key: string }>(
    `DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '1 hour' RETURNING key`,
  );
  return rows.length;
}
