/**
 * Time-travel recall — asking what the agent believed at a past instant.
 *
 * CockroachDB is an MVCC store: every superseded row version is retained until garbage collection.
 * `SELECT ... AS OF SYSTEM TIME <t>` reads the database as it existed at `t`. For an agent memory
 * layer that means we can reconstruct a past belief state exactly, with no history table, no
 * snapshotting, and no additional write cost — the versions are already there.
 *
 * The retention window is the table's `gc.ttlseconds`, which schema.sql raises to 7 days.
 */
import { query } from './db.js';
import { embed, toVectorLiteral } from './embeddings.js';
import type { Memory, MemoryKind } from './memory.js';

/**
 * CockroachDB rejects bound parameters in AS OF SYSTEM TIME — it accepts only constant expressions.
 * That forces string interpolation, so this validator is the only thing standing between a user-
 * supplied value and the query text. It is deliberately an allowlist of three exact shapes rather
 * than a blocklist of dangerous characters.
 *
 *   -1h, -30m, -7d      relative interval, past only
 *   2026-08-07T12:00:00Z  ISO 8601 instant
 *   follower             nearest-replica read (~4.8s stale, lower latency)
 */
const RELATIVE = /^-\d{1,6}(?:us|ms|s|m|h|d)$/;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?$/;

export class InvalidTimestampError extends Error {}

/** Returns a SQL fragment safe to interpolate directly after `AS OF SYSTEM TIME`. */
export function asOfClause(at: string | Date): string {
  if (at instanceof Date) {
    if (Number.isNaN(at.getTime())) throw new InvalidTimestampError('Invalid Date');
    if (at.getTime() > Date.now()) {
      throw new InvalidTimestampError('Cannot read the database at a future timestamp');
    }
    return `'${at.toISOString()}'`;
  }

  const value = at.trim();

  if (value === 'follower') return 'follower_read_timestamp()';
  if (RELATIVE.test(value)) return `'${value}'`;

  if (ISO.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new InvalidTimestampError(`Unparseable timestamp: ${value}`);
    if (parsed.getTime() > Date.now()) {
      throw new InvalidTimestampError('Cannot read the database at a future timestamp');
    }
    return `'${parsed.toISOString()}'`;
  }

  throw new InvalidTimestampError(
    `Unrecognized timestamp "${value}". Use a past interval like -2h, an ISO 8601 instant, or "follower".`,
  );
}

export interface TimeTravelHit extends Memory {
  distance: number;
}

/**
 * Semantic recall against a past state of the memory store.
 *
 * The vector index is MVCC-aware too, so this is still an indexed ANN search — not a scan.
 */
export async function recallAsOf(opts: {
  tenantId: string;
  agentId: string;
  query: string;
  at: string | Date;
  limit?: number;
  kinds?: MemoryKind[];
}): Promise<TimeTravelHit[]> {
  const clause = asOfClause(opts.at);
  const embedded = await embed(opts.query, 'query');
  const vector = toVectorLiteral(embedded.vector);

  const rows = await query<Memory & { distance: string }>(
    `SELECT id, kind, content, importance, confidence, tags, metadata, access_count, created_at,
            embedding <-> $3 AS distance
       FROM memories AS OF SYSTEM TIME ${clause}
      WHERE tenant_id = $1
        AND agent_id = $2
        AND superseded_by IS NULL
        AND ($4::STRING[] IS NULL OR kind = ANY($4))
        AND embedding_model = $6
      ORDER BY embedding <-> $3
      LIMIT $5`,
    [opts.tenantId, opts.agentId, vector, opts.kinds ?? null, opts.limit ?? 6, embedded.model],
  );

  return rows.map((row) => ({ ...row, distance: Number(row.distance) }));
}

export interface BeliefDiff {
  at: string;
  then: TimeTravelHit[];
  now: TimeTravelHit[];
  /** Live now, absent then — the agent learned these in the interval. */
  learned: TimeTravelHit[];
  /** Present then, no longer live — corrected, superseded, or forgotten. */
  changed: TimeTravelHit[];
  /** Present in both. */
  unchanged: TimeTravelHit[];
}

/**
 * Compares what the agent believed about a topic at a past instant against what it believes now.
 *
 * This is the question an audit actually asks: not "what is in the database" but "what changed, and
 * when did it change?" Answering it costs one extra indexed read.
 */
export async function beliefDiff(opts: {
  tenantId: string;
  agentId: string;
  query: string;
  at: string | Date;
  limit?: number;
}): Promise<BeliefDiff> {
  const limit = opts.limit ?? 10;

  const [then, now] = await Promise.all([
    recallAsOf({ ...opts, limit }),
    recallAsOf({ ...opts, at: '-1us', limit }),
  ]);

  const thenIds = new Set(then.map((m) => m.id));
  const nowIds = new Set(now.map((m) => m.id));

  return {
    at: opts.at instanceof Date ? opts.at.toISOString() : String(opts.at),
    then,
    now,
    learned: now.filter((m) => !thenIds.has(m.id)),
    changed: then.filter((m) => !nowIds.has(m.id)),
    unchanged: now.filter((m) => thenIds.has(m.id)),
  };
}

export interface ProvenanceStep {
  id: string;
  content: string;
  kind: MemoryKind;
  confidence: number;
  created_at: string;
  relation: string | null;
}

/**
 * Walks the supersession chain backwards from a live memory to its earliest ancestor, so you can see
 * how a belief was revised over time.
 *
 * Uses a recursive CTE rather than a query per hop — the chain is walked inside the database.
 */
export async function provenance(opts: {
  tenantId: string;
  memoryId: string;
}): Promise<ProvenanceStep[]> {
  return query<ProvenanceStep>(
    `WITH RECURSIVE chain AS (
        SELECT m.id, m.content, m.kind, m.confidence, m.created_at,
               NULL::STRING AS relation, 0 AS depth
          FROM memories m
         WHERE m.tenant_id = $1 AND m.id = $2

        UNION ALL

        SELECT prev.id, prev.content, prev.kind, prev.confidence, prev.created_at,
               l.relation, chain.depth + 1
          FROM chain
          JOIN memory_links l ON l.src_id = chain.id AND l.tenant_id = $1
          JOIN memories prev  ON prev.id = l.dst_id AND prev.tenant_id = $1
         WHERE chain.depth < 25
     )
     SELECT id, content, kind, confidence, created_at, relation
       FROM chain
      ORDER BY depth`,
    [opts.tenantId, opts.memoryId],
  );
}

/**
 * The maximum age time travel can reach, read from the table's actual zone configuration rather than
 * assumed — so the UI can offer a range it can really serve instead of erroring at the boundary.
 */
export async function retentionWindowSeconds(): Promise<number> {
  try {
    const [row] = await query<{ raw_config_sql: string }>(
      `SELECT raw_config_sql FROM [SHOW ZONE CONFIGURATION FOR TABLE memories]`,
    );
    const match = row?.raw_config_sql?.match(/gc\.ttlseconds\s*=\s*(\d+)/);
    return match ? Number(match[1]) : 14400;
  } catch {
    return 14400; // CockroachDB's default, 4 hours.
  }
}
