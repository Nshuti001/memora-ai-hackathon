import type { PoolClient } from 'pg';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { activeEmbeddingModel, embed, toVectorLiteral } from './embeddings.js';

export type MemoryKind = 'episodic' | 'semantic' | 'procedural';

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  confidence: number;
  tags: string[];
  metadata: Record<string, unknown>;
  access_count: number;
  created_at: string;
  shared?: boolean;
}

export interface RecalledMemory extends Memory {
  /** L2 distance on unit vectors: 0 is identical, 2 is opposite. */
  distance: number;
  /** distance mapped to a 0..1 similarity, then weighted by importance and recency. */
  score: number;
}

export interface RememberInput {
  tenantId: string;
  agentId: string;
  sessionId?: string | null;
  content: string;
  kind?: MemoryKind;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  shared?: boolean;
}

/**
 * A memory is "live" when it has not been superseded by a correction and has not been archived by
 * decay. Every recall path filters on this, so it lives in one place — a query that forgets one half
 * of the condition silently resurrects corrected beliefs, which is the worst failure this system has.
 */
const LIVE = 'superseded_by IS NULL AND archived_at IS NULL';

const RETURNING_COLUMNS = `id, kind, content, importance, confidence, tags, metadata,
                           access_count, created_at, shared`;

/**
 * Below this L2 distance two memories are treated as the same fact restated. Calibrated per
 * embedding provider — see the THRESHOLDS table in config.ts for the measured distance bands.
 */
export const NEAR_DUPLICATE_DISTANCE = config.thresholds.nearDuplicate;

/** Half-life used to decay a memory's recall score, in days. */
export const RECENCY_HALF_LIFE_DAYS = 30;

export function scoreOf(distance: number, importance: number, ageMs: number): number {
  const similarity = Math.max(0, 1 - distance / 2);
  const ageDays = ageMs / 86_400_000;
  const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);

  // Similarity dominates; importance and recency only break ties among comparably relevant hits,
  // so a highly relevant old memory still beats a fresh irrelevant one.
  return similarity * 0.7 + importance * 0.2 + recency * 0.1;
}

/**
 * Writes a memory, embedding it first.
 *
 * If a near-identical live memory already exists for this agent, we do not insert a second row —
 * we reinforce the existing one (bump importance, refresh timestamp) and return it. Without this,
 * an agent that hears the same preference in ten conversations accumulates ten rows and its recall
 * degrades into repetition.
 */
export async function remember(
  input: RememberInput,
): Promise<{ memory: Memory; deduplicated: boolean }> {
  const embedded = await embed(input.content);
  const vector = toVectorLiteral(embedded.vector);

  return withTransaction(async (client) => {
    const { rows: near } = await client.query<Memory & { distance: string }>(
      `SELECT ${RETURNING_COLUMNS}, embedding <-> $3 AS distance
         FROM memories
        WHERE tenant_id = $1 AND agent_id = $2 AND ${LIVE}
          AND embedding_model = $4
        ORDER BY embedding <-> $3
        LIMIT 1`,
      [input.tenantId, input.agentId, vector, embedded.model],
    );

    const existing = near[0];
    if (existing && Number(existing.distance) <= NEAR_DUPLICATE_DISTANCE) {
      const { rows } = await client.query<Memory>(
        `UPDATE memories
            SET importance = least(1.0, importance + 0.05),
                access_count = access_count + 1,
                updated_at = now()
          WHERE id = $1
      RETURNING ${RETURNING_COLUMNS}`,
        [existing.id],
      );

      await logAudit(client, {
        tenantId: input.tenantId,
        agentId: input.agentId,
        operation: 'remember.deduplicated',
        query: input.content,
        resultIds: [existing.id],
      });

      return { memory: rows[0], deduplicated: true };
    }

    const { rows } = await client.query<Memory>(
      `INSERT INTO memories (tenant_id, agent_id, session_id, kind, content, embedding,
                             importance, tags, metadata, shared, embedding_model)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${RETURNING_COLUMNS}`,
      [
        input.tenantId,
        input.agentId,
        input.sessionId ?? null,
        input.kind ?? 'episodic',
        input.content,
        vector,
        input.importance ?? 0.5,
        input.tags ?? [],
        JSON.stringify(input.metadata ?? {}),
        input.shared ?? false,
        embedded.model,
      ],
    );

    await logAudit(client, {
      tenantId: input.tenantId,
      agentId: input.agentId,
      operation: 'remember',
      query: input.content,
      resultIds: [rows[0].id],
    });

    return { memory: rows[0], deduplicated: false };
  });
}

/**
 * Semantic recall over the distributed vector index.
 *
 * Reads more neighbours than requested and re-ranks them by score, so importance and recency can
 * promote a slightly-less-similar memory without hiding genuinely closer matches.
 *
 * With `includeShared`, memories other agents in the same tenant marked shared are searched too —
 * that is how one agent's discovery becomes available to the rest of the fleet.
 */
export async function recall(opts: {
  tenantId: string;
  agentId: string;
  query: string;
  limit?: number;
  kinds?: MemoryKind[];
  includeShared?: boolean;
}): Promise<RecalledMemory[]> {
  const limit = opts.limit ?? 6;
  const started = Date.now();
  const embedded = await embed(opts.query);
  const vector = toVectorLiteral(embedded.vector);

  const rows = await query<Memory & { distance: string }>(
    `SELECT ${RETURNING_COLUMNS}, embedding <-> $3 AS distance
       FROM memories
      WHERE tenant_id = $1
        AND (agent_id = $2 ${opts.includeShared ? 'OR shared = true' : ''})
        AND ${LIVE}
        AND ($4::STRING[] IS NULL OR kind = ANY($4))
        AND embedding_model = $6
      ORDER BY embedding <-> $3
      LIMIT $5`,
    [opts.tenantId, opts.agentId, vector, opts.kinds ?? null, limit * 3, embedded.model],
  );

  const now = Date.now();
  const ranked = rows
    .map((row) => ({
      ...row,
      distance: Number(row.distance),
      score: scoreOf(
        Number(row.distance),
        Number(row.importance),
        now - new Date(row.created_at).getTime(),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (ranked.length > 0) {
    // Recall is a read, but it updates access bookkeeping. Fire-and-forget so a stats write never
    // adds latency to the agent's critical path or fails the request.
    void query(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = now()
        WHERE id = ANY($1::UUID[])`,
      [ranked.map((m) => m.id)],
    ).catch((err) => console.error('[memory] access bookkeeping failed', err));
  }

  void withTransaction((client) =>
    logAudit(client, {
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      operation: 'recall',
      query: opts.query,
      resultIds: ranked.map((m) => m.id),
      latencyMs: Date.now() - started,
    }),
  ).catch((err) => console.error('[memory] audit write failed', err));

  return ranked;
}

/**
 * Marks `oldId` as replaced by a new memory, and records the edge.
 *
 * Corrections supersede rather than delete: recall skips superseded rows, but the original stays
 * queryable so you can answer "what did the agent believe last week, and when did that change?"
 */
export async function supersede(opts: {
  tenantId: string;
  agentId: string;
  oldId: string;
  content: string;
  kind?: MemoryKind;
  importance?: number;
}): Promise<Memory> {
  const { memory } = await remember({
    tenantId: opts.tenantId,
    agentId: opts.agentId,
    content: opts.content,
    kind: opts.kind ?? 'semantic',
    importance: opts.importance ?? 0.7,
  });

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE memories SET superseded_by = $1, confidence = 0.3, updated_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [memory.id, opts.oldId, opts.tenantId],
    );
    await client.query(
      `INSERT INTO memory_links (tenant_id, src_id, dst_id, relation)
            VALUES ($1, $2, $3, 'supersedes')
       ON CONFLICT DO NOTHING`,
      [opts.tenantId, memory.id, opts.oldId],
    );
  });

  return memory;
}

/**
 * Last-resort recall that needs no embedding service.
 *
 * Semantic recall depends on Bedrock being reachable to embed the query. When it is not — no
 * credentials, a quota exhausted mid-demo, a regional outage — this keeps the memory layer answering
 * by matching terms in SQL instead. It is strictly worse than vector recall (lexical overlap only,
 * no synonyms) and callers must label it as such, but it means the store is never unreadable just
 * because an external service is down.
 *
 * Ranking counts how many query terms appear, then breaks ties on importance.
 */
export async function recallLexical(opts: {
  tenantId: string;
  agentId: string;
  query: string;
  limit?: number;
  includeShared?: boolean;
}): Promise<Memory[]> {
  const terms = opts.query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);

  if (terms.length === 0) return [];

  return query<Memory>(
    `SELECT ${RETURNING_COLUMNS}
       FROM memories
      WHERE tenant_id = $1
        AND (agent_id = $2 ${opts.includeShared ? 'OR shared = true' : ''})
        AND ${LIVE}
        AND content ILIKE ANY (SELECT '%' || unnest($3::STRING[]) || '%')
      ORDER BY (
        SELECT count(*) FROM unnest($3::STRING[]) AS t
         WHERE content ILIKE '%' || t || '%'
      ) DESC, importance DESC
      LIMIT $4`,
    [opts.tenantId, opts.agentId, terms, opts.limit ?? 5],
  );
}

export async function listMemories(opts: {
  tenantId: string;
  agentId: string;
  limit?: number;
}): Promise<Memory[]> {
  return query<Memory>(
    `SELECT ${RETURNING_COLUMNS}
       FROM memories
      WHERE tenant_id = $1 AND agent_id = $2 AND ${LIVE}
      ORDER BY created_at DESC
      LIMIT $3`,
    [opts.tenantId, opts.agentId, opts.limit ?? 50],
  );
}

export interface GraphEdge {
  src_id: string;
  dst_id: string;
  relation: string;
  weight: number;
}

export type GraphNodeStatus = 'live' | 'superseded' | 'archived';

export interface GraphNode extends Memory {
  status: GraphNodeStatus;
}

/**
 * Nodes and edges for the knowledge graph.
 *
 * Explicit edges come from memory_links (supersession, consolidation). On top of those we add
 * implicit `similar_to` edges by asking the vector index, for each node, for its nearest neighbour —
 * so the graph shows semantic structure the agent never wrote down explicitly.
 *
 * Superseded and archived memories are pulled back in when a live memory points at them. Without
 * that, a correction's `supersedes` edge would dangle: the belief it replaced is not live, so it
 * would be missing from the node set and the edge would be dropped — hiding precisely the revision
 * history the graph exists to show. They carry a `status` so the UI can render them faded.
 *
 * This reaches exactly one hop into history, deliberately: a belief revised many times would
 * otherwise drag its entire ancestry into a view meant to show the current state. For the full
 * chain, use provenance() in time-travel.ts, which walks it with a recursive CTE.
 */
export async function graph(opts: {
  tenantId: string;
  agentId: string;
  limit?: number;
  includeSimilar?: boolean;
}): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const live = await listMemories({ ...opts, limit: opts.limit ?? 40 });
  if (live.length === 0) return { nodes: [], edges: [] };

  const liveIds = live.map((n) => n.id);

  const explicit = await query<GraphEdge>(
    `SELECT src_id, dst_id, relation, weight
       FROM memory_links
      WHERE tenant_id = $1 AND (src_id = ANY($2::UUID[]) OR dst_id = ANY($2::UUID[]))`,
    [opts.tenantId, liveIds],
  );

  // Any edge endpoint we don't already have as a live node — these are the superseded ancestors.
  const missing = [
    ...new Set(
      explicit.flatMap((e) => [e.src_id, e.dst_id]).filter((id) => !liveIds.includes(id)),
    ),
  ];

  const historical = missing.length
    ? await query<Memory & { superseded_by: string | null; archived_at: string | null }>(
        `SELECT ${RETURNING_COLUMNS}, superseded_by, archived_at
           FROM memories
          WHERE tenant_id = $1 AND id = ANY($2::UUID[])`,
        [opts.tenantId, missing],
      )
    : [];

  const nodes: GraphNode[] = [
    ...live.map((m) => ({ ...m, status: 'live' as const })),
    ...historical.map((m) => ({
      ...m,
      status: (m.superseded_by ? 'superseded' : 'archived') as GraphNodeStatus,
    })),
  ];

  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  // Drop any edge whose other endpoint fell outside the page we fetched.
  const usable = explicit.filter((e) => known.has(e.src_id) && known.has(e.dst_id));

  if (opts.includeSimilar === false) return { nodes, edges: usable };

  // One lateral join instead of N round trips: for each node, its single nearest live neighbour.
  const similar = await query<GraphEdge>(
    `SELECT m.id AS src_id, nn.id AS dst_id, 'similar_to' AS relation,
            (1 - nn.distance / 2) AS weight
       FROM memories m
       JOIN LATERAL (
            SELECT o.id, o.embedding <-> m.embedding AS distance
              FROM memories o
             WHERE o.tenant_id = m.tenant_id AND o.agent_id = m.agent_id
               AND o.id != m.id AND o.${LIVE}
             ORDER BY o.embedding <-> m.embedding
             LIMIT 1
       ) nn ON true
      WHERE m.tenant_id = $1 AND m.id = ANY($2::UUID[]) AND nn.distance < 1.0`,
    [opts.tenantId, liveIds],
  );

  const seen = new Set(usable.map((e) => `${e.src_id}:${e.dst_id}`));
  const merged = [...usable];
  for (const edge of similar) {
    // Skip a similarity edge that duplicates an explicit one in either direction.
    if (seen.has(`${edge.src_id}:${edge.dst_id}`) || seen.has(`${edge.dst_id}:${edge.src_id}`)) {
      continue;
    }
    seen.add(`${edge.src_id}:${edge.dst_id}`);
    merged.push({ ...edge, weight: Number(edge.weight) });
  }

  return { nodes, edges: merged };
}

export interface MemoryStats {
  total: number;
  episodic: number;
  semantic: number;
  procedural: number;
  superseded: number;
  archived: number;
  shared: number;
  consolidated: number;
  avgRecallMs: number | null;
  avgImportance: number | null;
}

export async function stats(opts: { tenantId: string; agentId: string }): Promise<MemoryStats> {
  const [row] = await query<Record<string, string | null>>(
    `SELECT count(*) FILTER (WHERE ${LIVE})                                   AS total,
            count(*) FILTER (WHERE kind = 'episodic'   AND ${LIVE})           AS episodic,
            count(*) FILTER (WHERE kind = 'semantic'   AND ${LIVE})           AS semantic,
            count(*) FILTER (WHERE kind = 'procedural' AND ${LIVE})           AS procedural,
            count(*) FILTER (WHERE superseded_by IS NOT NULL)                 AS superseded,
            count(*) FILTER (WHERE archived_at IS NOT NULL)                   AS archived,
            count(*) FILTER (WHERE shared = true AND ${LIVE})                 AS shared,
            count(*) FILTER (WHERE consolidated_at IS NOT NULL)               AS consolidated,
            avg(importance) FILTER (WHERE ${LIVE})                            AS avg_importance,
            (SELECT avg(latency_ms) FROM memory_audit
              WHERE tenant_id = $1 AND operation = 'recall')                  AS avg_recall_ms
       FROM memories
      WHERE tenant_id = $1 AND agent_id = $2`,
    [opts.tenantId, opts.agentId],
  );

  const num = (key: string) => Number(row?.[key] ?? 0);

  return {
    total: num('total'),
    episodic: num('episodic'),
    semantic: num('semantic'),
    procedural: num('procedural'),
    superseded: num('superseded'),
    archived: num('archived'),
    shared: num('shared'),
    consolidated: num('consolidated'),
    avgRecallMs: row?.avg_recall_ms ? Math.round(Number(row.avg_recall_ms)) : null,
    avgImportance: row?.avg_importance ? Number(Number(row.avg_importance).toFixed(3)) : null,
  };
}

export interface EmbeddingHealth {
  activeModel: string;
  /** Live memories per embedding model, newest-written model first. */
  byModel: { model: string; count: number }[];
  /** Live memories the current model cannot search, because they sit in a different vector space. */
  unsearchable: number;
}

/**
 * Reports whether the store and the active embedding model agree.
 *
 * Recall filters on `embedding_model`, so memories written by a different model are invisible rather
 * than wrong — but invisible is still a bug from the user's point of view, and the only honest thing
 * to do is say so instead of quietly returning fewer results.
 */
export async function embeddingHealth(opts: {
  tenantId: string;
  agentId: string;
}): Promise<EmbeddingHealth> {
  const activeModel = activeEmbeddingModel();

  const rows = await query<{ embedding_model: string; count: string }>(
    `SELECT embedding_model, count(*) AS count
       FROM memories
      WHERE tenant_id = $1 AND agent_id = $2 AND ${LIVE}
      GROUP BY embedding_model
      ORDER BY count DESC`,
    [opts.tenantId, opts.agentId],
  );

  const byModel = rows.map((r) => ({ model: r.embedding_model, count: Number(r.count) }));

  return {
    activeModel,
    byModel,
    unsearchable: byModel
      .filter((r) => r.model !== activeModel)
      .reduce((sum, r) => sum + r.count, 0),
  };
}

export interface AuditEntry {
  id: string;
  operation: string;
  query: string | null;
  result_ids: string[];
  latency_ms: number | null;
  created_at: string;
}

export async function recentAudit(opts: {
  tenantId: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  return query<AuditEntry>(
    `SELECT id, operation, query, result_ids, latency_ms, created_at
       FROM memory_audit
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [opts.tenantId, opts.limit ?? 25],
  );
}

export async function logAudit(
  client: PoolClient,
  entry: {
    tenantId: string;
    agentId?: string | null;
    operation: string;
    query?: string | null;
    resultIds?: string[];
    latencyMs?: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO memory_audit (tenant_id, agent_id, operation, query, result_ids, latency_ms)
          VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.tenantId,
      entry.agentId ?? null,
      entry.operation,
      entry.query ?? null,
      entry.resultIds ?? [],
      entry.latencyMs ?? null,
    ],
  );
}
