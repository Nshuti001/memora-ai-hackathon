/**
 * Memory consolidation and decay — the maintenance an agent's memory needs to stay useful.
 *
 * Without this, a long-running agent's store only grows: hundreds of near-identical episodic
 * fragments, every one of them competing for the same recall slots, and the genuinely important
 * facts buried among them. Human memory solves this by consolidating episodes into durable
 * generalizations during sleep and letting unused detail fade. This does the same thing on a cron.
 *
 * Consolidation: cluster semantically-adjacent episodic memories, distill each cluster into one
 * semantic fact via Claude, and link the result back to its sources with `derived_from` edges. The
 * source episodes are kept, not deleted — the generalization is auditable back to the evidence.
 *
 * Decay: memories that are neither important nor accessed lose importance over time, and eventually
 * archive. Archived memories stay queryable by time travel; they just stop competing in recall.
 */
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { embed, toVectorLiteral } from './embeddings.js';
import { logAudit, type Memory } from './memory.js';

/**
 * Episodes closer than this are considered the same underlying topic. Calibrated per embedding
 * provider — see the THRESHOLDS table in config.ts.
 */
const CLUSTER_DISTANCE = config.thresholds.cluster;

/** Below this many related episodes there is nothing worth generalizing. */
const MIN_CLUSTER_SIZE = 3;

/** Importance floor at which a memory stops being worth recalling. */
const ARCHIVE_THRESHOLD = 0.15;

let bedrock: AnthropicBedrock | null = null;
function client(): AnthropicBedrock {
  if (!bedrock) {
    if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
      throw new Error('No AWS credentials for consolidation. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.');
    }
    bedrock = new AnthropicBedrock({
      awsRegion: config.awsRegion,
      awsAccessKey: config.awsAccessKeyId,
      awsSecretKey: config.awsSecretAccessKey,
    });
  }
  return bedrock;
}

export interface Cluster {
  seed: Memory;
  members: Memory[];
}

/**
 * Groups unconsolidated episodic memories into topic clusters.
 *
 * Greedy single-pass clustering: take the oldest unconsolidated episode as a seed, pull its
 * neighbours from the vector index, claim them, and repeat with the next unclaimed seed. This is not
 * optimal clustering, but it is one indexed query per cluster instead of an O(n²) distance matrix,
 * which is what matters when the store has hundreds of thousands of rows.
 */
export async function findClusters(opts: {
  tenantId: string;
  agentId: string;
  maxClusters?: number;
}): Promise<Cluster[]> {
  const seeds = await query<Memory & { embedding: string }>(
    `SELECT id, kind, content, importance, confidence, tags, metadata, access_count, created_at,
            embedding::STRING AS embedding
       FROM memories
      WHERE tenant_id = $1 AND agent_id = $2
        AND kind = 'episodic'
        AND consolidated_at IS NULL
        AND superseded_by IS NULL AND archived_at IS NULL
      ORDER BY created_at
      LIMIT 200`,
    [opts.tenantId, opts.agentId],
  );

  const claimed = new Set<string>();
  const clusters: Cluster[] = [];
  const maxClusters = opts.maxClusters ?? 5;

  for (const seed of seeds) {
    if (claimed.has(seed.id)) continue;
    if (clusters.length >= maxClusters) break;

    const neighbours = await query<Memory & { distance: string }>(
      `SELECT id, kind, content, importance, confidence, tags, metadata, access_count, created_at,
              embedding <-> $3 AS distance
         FROM memories
        WHERE tenant_id = $1 AND agent_id = $2
          AND kind = 'episodic'
          AND consolidated_at IS NULL
          AND superseded_by IS NULL AND archived_at IS NULL
        ORDER BY embedding <-> $3
        LIMIT 12`,
      [opts.tenantId, opts.agentId, seed.embedding],
    );

    const members = neighbours.filter(
      (n) => Number(n.distance) <= CLUSTER_DISTANCE && !claimed.has(n.id),
    );

    if (members.length < MIN_CLUSTER_SIZE) {
      claimed.add(seed.id);
      continue;
    }

    for (const member of members) claimed.add(member.id);
    clusters.push({ seed, members });
  }

  return clusters;
}

/**
 * Asks Claude to state the durable fact a group of episodes implies.
 *
 * Falls back to the highest-importance member verbatim when Bedrock is unavailable (local
 * development, or a Bedrock outage). Consolidation degrading to "keep the most important one" is
 * strictly better than the maintenance job failing and the store growing unbounded.
 */
async function distill(members: Memory[]): Promise<string> {
  const numbered = members.map((m, i) => `${i + 1}. ${m.content}`).join('\n');

  if (config.embeddingProvider === 'local') {
    return [...members].sort((a, b) => b.importance - a.importance)[0].content;
  }

  try {
    const response = await client().messages.create({
      model: config.modelId,
      max_tokens: 1000,
      system:
        'You distill related episodic memories into one durable fact. Reply with a single ' +
        'self-contained sentence that will still make sense in a year without the surrounding ' +
        'conversation. State only what the episodes actually support — do not extrapolate, and do ' +
        'not hedge with "the user seems to". If the episodes share no common fact, reply exactly NONE.',
      messages: [
        {
          role: 'user',
          content: `Related observations:\n\n${numbered}\n\nThe durable fact these support:`,
        },
      ],
    });

    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();

    if (!text || text === 'NONE') {
      return [...members].sort((a, b) => b.importance - a.importance)[0].content;
    }
    return text;
  } catch (err) {
    console.error('[consolidation] distillation failed, falling back to representative', err);
    return [...members].sort((a, b) => b.importance - a.importance)[0].content;
  }
}

export interface ConsolidationResult {
  clustersFound: number;
  memoriesCreated: { id: string; content: string; sourceCount: number }[];
  sourcesConsolidated: number;
}

export async function consolidate(opts: {
  tenantId: string;
  agentId: string;
  maxClusters?: number;
}): Promise<ConsolidationResult> {
  const started = Date.now();
  const clusters = await findClusters(opts);
  const created: ConsolidationResult['memoriesCreated'] = [];
  let sourcesConsolidated = 0;

  for (const cluster of clusters) {
    const content = await distill(cluster.members);
    const embedded = await embed(content);
    const vector = toVectorLiteral(embedded.vector);

    // Importance of a generalization is the strongest of its evidence, nudged up — a fact supported
    // by several episodes is more reliable than any single one of them.
    const importance = Math.min(
      1,
      Math.max(...cluster.members.map((m) => Number(m.importance))) + 0.1,
    );

    const memoryId = await withTransaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO memories (tenant_id, agent_id, kind, content, embedding, importance,
                               metadata, consolidated_at, embedding_model)
              VALUES ($1, $2, 'semantic', $3, $4, $5, $6, now(), $7)
           RETURNING id`,
        [
          opts.tenantId,
          opts.agentId,
          content,
          vector,
          importance,
          JSON.stringify({ derivedFrom: cluster.members.length, consolidatedAt: new Date().toISOString() }),
          embedded.model,
        ],
      );
      const id = rows[0].id;

      await tx.query(
        `UPDATE memories SET consolidated_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::UUID[])`,
        [opts.tenantId, cluster.members.map((m) => m.id)],
      );

      // One multi-row insert rather than a statement per edge — this runs inside a serializable
      // transaction, and every extra round trip widens the window for a retryable conflict.
      await tx.query(
        `INSERT INTO memory_links (tenant_id, src_id, dst_id, relation, weight)
              SELECT $1, $2, unnest($3::UUID[]), 'derived_from', 1.0
         ON CONFLICT DO NOTHING`,
        [opts.tenantId, id, cluster.members.map((m) => m.id)],
      );

      await logAudit(tx, {
        tenantId: opts.tenantId,
        agentId: opts.agentId,
        operation: 'consolidate',
        query: content,
        resultIds: [id, ...cluster.members.map((m) => m.id)],
        latencyMs: Date.now() - started,
      });

      return id;
    });

    created.push({ id: memoryId, content, sourceCount: cluster.members.length });
    sourcesConsolidated += cluster.members.length;
  }

  return { clustersFound: clusters.length, memoriesCreated: created, sourcesConsolidated };
}

export interface DecayResult {
  decayed: number;
  archived: number;
}

/**
 * Applies the forgetting curve.
 *
 * Importance decays with time since last access, at a rate damped by how often the memory has been
 * recalled — something retrieved twenty times decays far more slowly than something never retrieved.
 * Semantic and procedural memories decay at a third the rate of episodic ones, because a durable
 * fact should outlive the individual episodes that produced it.
 *
 * Both steps are single set-based UPDATEs. Pulling rows into the application to decay them one at a
 * time would turn routine maintenance into a load spike against the cluster.
 */
export async function decay(opts: {
  tenantId: string;
  agentId?: string;
  /** Scales the whole effect; 1.0 is one nominal maintenance cycle. */
  intensity?: number;
}): Promise<DecayResult> {
  const intensity = opts.intensity ?? 1;
  const agentFilter = opts.agentId ? 'AND agent_id = $2' : '';
  const params = opts.agentId ? [opts.tenantId, opts.agentId, intensity] : [opts.tenantId, intensity];
  const intensityParam = opts.agentId ? '$3' : '$2';

  // Every term is cast to FLOAT8 explicitly. CockroachDB's extract(epoch ...) yields DECIMAL and
  // there is no FLOAT8 * DECIMAL operator, so mixing them fails at type-check time rather than
  // silently coercing.
  const decayed = await query<{ id: string }>(
    `UPDATE memories
        SET importance = greatest(0::FLOAT8,
              importance::FLOAT8 - (
                ${intensityParam}::FLOAT8
                * 0.02::FLOAT8
                * (CASE kind WHEN 'episodic' THEN 1.0 ELSE 0.33 END)::FLOAT8
                * (1.0::FLOAT8 / (1.0::FLOAT8 + ln((1 + access_count)::FLOAT8)))
                * greatest(
                    1.0::FLOAT8,
                    extract(epoch FROM now() - coalesce(last_accessed_at, created_at))::FLOAT8
                      / 86400.0::FLOAT8
                  )
              )),
            updated_at = now()
      WHERE tenant_id = $1 ${agentFilter}
        AND superseded_by IS NULL AND archived_at IS NULL
        AND coalesce(last_accessed_at, created_at) < now() - INTERVAL '1 day'
      RETURNING id`,
    params,
  );

  const archived = await query<{ id: string }>(
    `UPDATE memories
        SET archived_at = now(), updated_at = now()
      WHERE tenant_id = $1 ${agentFilter}
        AND superseded_by IS NULL AND archived_at IS NULL
        AND importance < ${ARCHIVE_THRESHOLD}
        AND access_count = 0
      RETURNING id`,
    opts.agentId ? [opts.tenantId, opts.agentId] : [opts.tenantId],
  );

  return { decayed: decayed.length, archived: archived.length };
}

/** Restores an archived memory — decay is reversible, deletion would not be. */
export async function reinstate(opts: { tenantId: string; memoryId: string }): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE memories
        SET archived_at = NULL, importance = greatest(importance, 0.4), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND archived_at IS NOT NULL
      RETURNING id`,
    [opts.tenantId, opts.memoryId],
  );
  return rows.length > 0;
}
