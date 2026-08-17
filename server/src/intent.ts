/**
 * Intent classification by k-nearest-neighbour over the CockroachDB vector index.
 *
 * Memora already has to answer a classification question on every turn — *is this worth storing at
 * all, or is it small talk?* — and until now the answer was a word count: fewer than four words,
 * don't store. This replaces that guess with a real classifier, and the classifier is the database.
 *
 * There is no model to train, serve or version. Labelled examples are embedded with the same Cohere
 * pipeline that embeds memories and written to the same `memories` table under their own tenant, so
 * classifying an utterance is one approximate-nearest-neighbour query against
 * `memories_embedding_idx` — the identical index that serves recall. kNN is a lazy learner: the
 * "training" is the insert.
 *
 * Two decisions worth stating:
 *
 * - **Distance-weighted voting, not a plain majority.** Neighbours vote with weight 1/(d + eps), so
 *   a very close example outranks three mediocre ones. With unit-normalised vectors, L2 distance is
 *   a monotone function of cosine similarity, so this weighting is meaningful rather than arbitrary.
 * - **Out-of-scope is a distance threshold, not a class.** Training a class for "everything else" is
 *   a losing game — the complement of 150 intents is unbounded. Instead, if the nearest labelled
 *   example is further away than a threshold, the utterance is out of scope. The threshold is fitted
 *   on a validation split and never on test.
 */

import { query } from './db.js';
import { embed, toVectorLiteral } from './embeddings.js';

/** Returned when the nearest labelled example is too far to trust. */
export const OUT_OF_SCOPE = 'oos';

export interface Neighbour {
  intent: string;
  distance: number;
}

export interface Prediction {
  intent: string;
  /** Distance to the single nearest labelled example — what the threshold is applied to. */
  nearestDistance: number;
  /** Summed vote weight of the winning intent, over the total. 1.0 means every neighbour agreed. */
  confidence: number;
  neighbours: Neighbour[];
}

/**
 * The k in kNN. Small and odd: the classes are fine-grained (150 of them) and only ~30 examples
 * deep, so a wide neighbourhood reaches into neighbouring intents and blurs exactly the distinctions
 * the classifier exists to make.
 */
export const DEFAULT_K = 5;

/** Guards against a divide-by-zero when an utterance exactly matches a stored example. */
const EPSILON = 1e-6;

/**
 * Fetches the k nearest labelled examples for a piece of text.
 *
 * The query is deliberately the same shape recall() uses — same table, same tenant/agent prefix,
 * same `<->` operator — so it rides the same prefixed vector index rather than scanning.
 */
export async function nearestLabelled(opts: {
  tenantId: string;
  agentId: string;
  text: string;
  k?: number;
}): Promise<Neighbour[]> {
  const embedded = await embed(opts.text, 'query');
  return nearestLabelledByVector({ ...opts, vector: embedded.vector });
}

/**
 * The same lookup for a vector that has already been computed.
 *
 * Bulk evaluation embeds its queries in batches, so re-embedding inside the loop would undo the
 * batching entirely. Keeping the vector-taking form public also means callers that already hold an
 * embedding — recall, for instance — never pay for a second one.
 */
export async function nearestLabelledByVector(opts: {
  tenantId: string;
  agentId: string;
  vector: number[];
  k?: number;
}): Promise<Neighbour[]> {
  const k = opts.k ?? DEFAULT_K;
  const vector = toVectorLiteral(opts.vector);

  // The WHERE clause is deliberately bare: equality on the index prefix, and nothing else.
  //
  // CockroachDB will only plan a `vector search` when the query has that exact shape. An earlier
  // version also filtered on superseded_by, archived_at, embedding_model and the presence of an
  // intent tag — all reasonable-looking — and every one of them pushed the planner off
  // memories_embedding_idx onto a full scan with a top-k sort. EXPLAIN said `scan … 79% of the
  // table` instead of `vector search … prefix spans`, which would have quietly turned the ANN
  // lookup this is built on into a linear one.
  //
  // Those filters are redundant here rather than merely inconvenient: the labelled set lives under
  // its own tenant and agent, so the prefix already isolates it, and loadTrainingSet guarantees
  // every row carries an intent and a single embedding model. The invariant is enforced on write
  // so the read can stay on the index.
  const rows = await query<{ intent: string; distance: string }>(
    `SELECT metadata->>'intent' AS intent, embedding <-> $3 AS distance
       FROM memories
      WHERE tenant_id = $1 AND agent_id = $2
      ORDER BY embedding <-> $3
      LIMIT $4`,
    [opts.tenantId, opts.agentId, vector, k],
  );

  return rows
    .filter((r) => r.intent !== null)
    .map((r) => ({ intent: r.intent, distance: Number(r.distance) }));
}

/**
 * Classifies text against the labelled examples already in the store.
 *
 * `oosThreshold` is the distance beyond which the nearest labelled example is considered unrelated.
 * Pass the value fitted by `fitOosThreshold`; omit it to disable out-of-scope detection entirely and
 * always return the best in-scope guess.
 */
export async function classify(opts: {
  tenantId: string;
  agentId: string;
  text: string;
  k?: number;
  oosThreshold?: number;
}): Promise<Prediction> {
  const embedded = await embed(opts.text, 'query');
  return classifyVector({ ...opts, vector: embedded.vector });
}

/** classify() for a vector that has already been computed. See nearestLabelledByVector. */
export async function classifyVector(opts: {
  tenantId: string;
  agentId: string;
  vector: number[];
  k?: number;
  oosThreshold?: number;
}): Promise<Prediction> {
  const neighbours = await nearestLabelledByVector(opts);

  if (neighbours.length === 0) {
    return { intent: OUT_OF_SCOPE, nearestDistance: Infinity, confidence: 0, neighbours: [] };
  }

  const nearestDistance = neighbours[0].distance;

  const weights = new Map<string, number>();
  for (const n of neighbours) {
    weights.set(n.intent, (weights.get(n.intent) ?? 0) + 1 / (n.distance + EPSILON));
  }

  let winner = neighbours[0].intent;
  let best = -Infinity;
  let total = 0;
  for (const [intent, weight] of weights) {
    total += weight;
    if (weight > best) {
      best = weight;
      winner = intent;
    }
  }

  const outOfScope = opts.oosThreshold !== undefined && nearestDistance > opts.oosThreshold;

  return {
    intent: outOfScope ? OUT_OF_SCOPE : winner,
    nearestDistance,
    confidence: total > 0 ? best / total : 0,
    neighbours,
  };
}

/**
 * Picks the out-of-scope distance threshold from a validation split.
 *
 * Sweeps candidate thresholds and keeps the one with the best balanced accuracy — the mean of
 * in-scope accuracy and out-of-scope recall. Plain accuracy would be the wrong objective: the two
 * error types trade against each other, and a threshold that admits everything scores well on a
 * validation set that is mostly in-scope while being useless at its actual job.
 *
 * Must be called with validation data. Fitting this on test would leak the test set and inflate
 * every number that follows.
 */
export function fitOosThreshold(
  inScopeDistances: number[],
  oosDistances: number[],
): { threshold: number; balancedAccuracy: number } {
  const candidates = [...new Set([...inScopeDistances, ...oosDistances])].sort((a, b) => a - b);
  if (candidates.length === 0) return { threshold: Infinity, balancedAccuracy: 0 };

  let bestThreshold = candidates[candidates.length - 1];
  let bestScore = -Infinity;

  for (const t of candidates) {
    const inScopeKept = inScopeDistances.filter((d) => d <= t).length / (inScopeDistances.length || 1);
    const oosRejected = oosDistances.filter((d) => d > t).length / (oosDistances.length || 1);
    const balanced = (inScopeKept + oosRejected) / 2;
    if (balanced > bestScore) {
      bestScore = balanced;
      bestThreshold = t;
    }
  }

  return { threshold: bestThreshold, balancedAccuracy: bestScore };
}
