import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createHash } from 'node:crypto';
import { config } from './config.js';

/** Titan Text Embeddings V2 default output width. Must match VECTOR(1024) in schema.sql. */
export const EMBED_DIM = 1024;

let bedrock: BedrockRuntimeClient | null = null;
function bedrockClient(): BedrockRuntimeClient {
  if (!bedrock) {
    bedrock = new BedrockRuntimeClient({
      region: config.awsRegion,
      ...(config.awsAccessKeyId && config.awsSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.awsAccessKeyId,
              secretAccessKey: config.awsSecretAccessKey,
            },
          }
        : {}),
    });
  }
  return bedrock;
}

/**
 * Once auto-mode has seen a Bedrock failure this process, stay on local embeddings.
 * Re-trying Titan on every write burns seconds against throttle responses and stalls seed/chat.
 */
let autoUseLocalOnly = false;

/** Latched once Titan proves unavailable, so auto stops retrying it on every write. */
let autoSkipTitan = false;

/**
 * Scale a vector to unit length.
 *
 * CockroachDB's vector index only accelerates L2 distance (<->). For unit-length vectors, L2 distance
 * is a monotonic function of cosine distance, so ranking by <-> gives exactly the cosine ranking we
 * want — at index speed instead of a full scan. Skipping this makes recall silently wrong, because
 * longer documents would rank as "far" purely for having larger magnitude.
 */
export function toUnitVector(values: number[]): number[] {
  let sumOfSquares = 0;
  for (const v of values) sumOfSquares += v * v;

  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) return values;

  return values.map((v) => v / magnitude);
}

/** CockroachDB parses VECTOR literals from the same bracketed text format pgvector uses. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Local provider — development and tests only
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our',
  'she', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when',
  'which', 'who', 'will', 'with', 'you', 'your',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Deterministic bucket for a token, via the hashing trick. */
function bucketOf(token: string): number {
  return createHash('sha1').update(token).digest().readUInt32BE(0) % EMBED_DIM;
}

/**
 * A deterministic, offline stand-in for a real embedding model.
 *
 * This is NOT a semantic embedder — it is a hashed bag-of-words with sub-linear term frequency, so it
 * captures lexical overlap and nothing more ("dark mode preference" matches "user prefers dark mode",
 * but "when do you ship" will not match "deploys on Fridays"). It exists so the memory layer, the
 * schema, and the vector index can be exercised in tests and local development without AWS
 * credentials or per-call Bedrock cost.
 *
 * Never use it in a deployed environment — set EMBEDDING_PROVIDER=bedrock there.
 */
export function localEmbed(text: string): number[] {
  const vector = new Array<number>(EMBED_DIM).fill(0);
  const counts = new Map<number, number>();

  const tokens = tokenize(text);
  for (const token of tokens) {
    const bucket = bucketOf(token);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);

    // Character trigrams give partial credit for morphological variants ("deploy"/"deploying").
    for (let i = 0; i + 3 <= token.length; i++) {
      const trigramBucket = bucketOf(`${token.slice(i, i + 3)}`);
      counts.set(trigramBucket, (counts.get(trigramBucket) ?? 0) + 0.35);
    }
  }

  for (const [bucket, count] of counts) {
    vector[bucket] = 1 + Math.log(count);
  }

  return toUnitVector(vector);
}

// ---------------------------------------------------------------------------
// Bedrock provider — production
// ---------------------------------------------------------------------------

async function bedrockEmbed(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: config.embedModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text,
      dimensions: EMBED_DIM,
      normalize: true,
    }),
  });

  const response = await bedrockClient().send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    embedding?: number[];
  };

  if (!payload.embedding || payload.embedding.length !== EMBED_DIM) {
    throw new Error(
      `Bedrock returned ${payload.embedding?.length ?? 0} dimensions, expected ${EMBED_DIM}. ` +
        `If you changed BEDROCK_EMBED_MODEL_ID, update EMBED_DIM and the VECTOR(...) column together.`,
    );
  }

  // Titan already normalizes when asked, but we normalize again rather than trusting the flag —
  // the index correctness argument above depends on it, and a second pass over 1024 floats is free.
  return toUnitVector(payload.embedding);
}

// ---------------------------------------------------------------------------
// Cohere Embed v3 on Bedrock
// ---------------------------------------------------------------------------

/**
 * Cohere's embeddings are asymmetric: a stored passage and the question that should retrieve it are
 * embedded with different `input_type` values, and the model is trained so those two spaces line up.
 * Using `search_document` for a query measurably degrades retrieval, so the caller's intent has to
 * reach this far down rather than being guessed here.
 */
export type EmbedPurpose = 'document' | 'query';

/**
 * Cohere accepts up to 96 texts per invocation. Bedrock's rate limits are counted per *request*, not
 * per text, so batching is the difference between one throttled call and ninety-six of them.
 */
export const COHERE_MAX_BATCH = 96;

/**
 * Embeds a batch of texts in a single Bedrock invocation.
 *
 * Order is preserved: `embeddings[i]` corresponds to `texts[i]`, which the callers rely on to pair
 * vectors back to their source rows.
 */
async function cohereEmbedMany(texts: string[], purpose: EmbedPurpose): Promise<number[][]> {
  if (texts.length > COHERE_MAX_BATCH) {
    throw new Error(`Cohere accepts at most ${COHERE_MAX_BATCH} texts per call, got ${texts.length}`);
  }

  const command = new InvokeModelCommand({
    modelId: config.cohereEmbedModelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      texts,
      input_type: purpose === 'query' ? 'search_query' : 'search_document',
      truncate: 'END',
    }),
  });

  const response = await bedrockClient().send(command);
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    embeddings?: number[][] | { float?: number[][] };
  };

  // Cohere returns `embeddings` as a bare array, or as { float: [...] } when embedding_types is set.
  const rows = Array.isArray(payload.embeddings) ? payload.embeddings : payload.embeddings?.float;

  if (!rows || rows.length !== texts.length) {
    throw new Error(`Cohere returned ${rows?.length ?? 0} embeddings for ${texts.length} texts`);
  }

  return rows.map((raw) => {
    if (!raw || raw.length !== EMBED_DIM) {
      throw new Error(
        `Cohere returned ${raw?.length ?? 0} dimensions, expected ${EMBED_DIM}. ` +
          `If you changed COHERE_EMBED_MODEL_ID, update EMBED_DIM and the VECTOR(...) column together.`,
      );
    }
    return toUnitVector(raw);
  });
}

async function cohereEmbed(text: string, purpose: EmbedPurpose): Promise<number[]> {
  const [vector] = await cohereEmbedMany([text], purpose);
  return vector;
}

// ---------------------------------------------------------------------------

/** Identifier for the lexical stand-in. Versioned so a change to the algorithm invalidates cached vectors. */
export const LOCAL_MODEL_ID = 'local-lexical-v1';

/** The model a vector came from, carried alongside it. */
export interface Embedding {
  vector: number[];
  model: string;
}

/**
 * The model `embed()` will use right now.
 *
 * In auto mode this flips to the local id once Bedrock has failed in this process, which is exactly
 * why it must be read at call time rather than derived from config once at startup.
 */
export function activeEmbeddingModel(): string {
  if (config.embeddingProvider === 'local') return LOCAL_MODEL_ID;
  if (config.embeddingProvider === 'bedrock') return config.embedModelId;
  if (config.embeddingProvider === 'cohere') return config.cohereEmbedModelId;

  // auto: Titan, then Cohere, then local — degraded one step at a time as each proves unavailable.
  if (autoUseLocalOnly) return LOCAL_MODEL_ID;
  if (autoSkipTitan) return config.cohereEmbedModelId;
  return config.embedModelId;
}

const cache = new Map<string, number[]>();
const CACHE_LIMIT = 500;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Reads a previously computed vector out of CockroachDB.
 *
 * Only Bedrock vectors are worth persisting — a local embedding is cheaper to recompute than to
 * fetch over the network. Any failure here is swallowed: the cache is an optimization, and an
 * unavailable cache must never take embedding down.
 */
async function readCache(model: string, text: string): Promise<number[] | null> {
  try {
    const { query } = await import('./db.js');
    const rows = await query<{ embedding: string }>(
      `UPDATE embedding_cache SET hits = hits + 1
        WHERE model = $1 AND text_sha256 = $2
    RETURNING embedding::STRING AS embedding`,
      [model, sha256(text)],
    );
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].embedding) as number[];
  } catch {
    return null;
  }
}

async function writeCache(model: string, text: string, vector: number[]): Promise<void> {
  try {
    const { query } = await import('./db.js');
    await query(
      `INSERT INTO embedding_cache (model, text_sha256, embedding) VALUES ($1, $2, $3)
       ON CONFLICT (model, text_sha256) DO NOTHING`,
      [model, sha256(text), toVectorLiteral(vector)],
    );
  } catch {
    /* optimization only */
  }
}

/**
 * Embeds text with the configured provider, returning the vector *and* the model that produced it.
 *
 * Callers must persist the model alongside the vector. Two models produce points in unrelated
 * spaces, so a vector without its model is not safely comparable to anything — returning them
 * together makes that impossible to forget.
 *
 * Three cache layers, cheapest first: an in-process map for the current conversation, a CockroachDB
 * table shared by every instance and surviving restarts, then the model itself.
 */
export async function embed(text: string, purpose: EmbedPurpose = 'document'): Promise<Embedding> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Cannot embed empty text');

  const wanted = activeEmbeddingModel();

  // Cohere embeds a passage and a question differently on purpose, so the two must not share a cache
  // entry. Titan and the local provider ignore purpose, and collapsing the key for them keeps a
  // query and the memory it retrieves sharing one cached vector.
  const purposeKey = wanted === config.cohereEmbedModelId ? purpose : 'x';
  const key = `${wanted}:${purposeKey}:${trimmed}`;
  const cacheModelKey = `${wanted}#${purposeKey}`;

  const hot = cache.get(key);
  if (hot) return { vector: hot, model: wanted };

  if (wanted !== LOCAL_MODEL_ID) {
    const persisted = await readCache(cacheModelKey, trimmed);
    if (persisted) {
      cache.set(key, persisted);
      return { vector: persisted, model: wanted };
    }
  }

  let vector: number[];
  let model = wanted;

  if (wanted === LOCAL_MODEL_ID) {
    vector = localEmbed(trimmed);
  } else if (config.embeddingProvider === 'bedrock') {
    vector = await bedrockEmbed(trimmed);
  } else if (config.embeddingProvider === 'cohere') {
    vector = await cohereEmbed(trimmed, purpose);
  } else {
    // auto: Titan, then Cohere, then local. Each fallback is latched for the process so a throttled
    // provider is not retried on every write, and `model` follows the demotion so the caller records
    // what actually produced this vector.
    const attempt = async (): Promise<number[]> => {
      if (!autoSkipTitan) {
        try {
          return await bedrockEmbed(trimmed);
        } catch (err) {
          autoSkipTitan = true;
          console.warn(
            `[embeddings] Titan unavailable (${short(err)}). Trying Cohere for this process.`,
          );
        }
      }

      try {
        model = config.cohereEmbedModelId;
        return await cohereEmbed(trimmed, purpose);
      } catch (err) {
        autoUseLocalOnly = true;
        model = LOCAL_MODEL_ID;
        console.warn(
          `[embeddings] Cohere unavailable (${short(err)}). Falling back to local embeddings — ` +
            `these are lexical only, not semantic.`,
        );
        return localEmbed(trimmed);
      }
    };

    vector = autoUseLocalOnly ? localEmbed(trimmed) : await attempt();
    if (autoUseLocalOnly) model = LOCAL_MODEL_ID;
  }

  const finalPurposeKey = model === config.cohereEmbedModelId ? purpose : 'x';
  if (model !== LOCAL_MODEL_ID) void writeCache(`${model}#${finalPurposeKey}`, trimmed, vector);

  if (cache.size >= CACHE_LIMIT) {
    // Cheap FIFO eviction — this is a hot-path cache for one conversation, not a durable store.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(`${model}:${finalPurposeKey}:${trimmed}`, vector);

  return { vector, model };
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 100);
}

/**
 * Embeds many texts, batching into as few Bedrock calls as the provider allows.
 *
 * This used to loop over `embed()` one text at a time. That is correct but pathologically slow at
 * bulk sizes: Bedrock throttles per *request*, so 450 texts meant 450 chances to be throttled, and
 * the backoff between them dominated everything. Cohere takes 96 texts per call, which turns the
 * same work into five requests.
 *
 * Batches never go out concurrently — the point is to make fewer requests, not more parallel ones.
 * Providers without a batch API (Titan, the local stand-in) fall back to the serial path, and any
 * text already in the cache is served from it rather than re-sent.
 */
export async function embedBatch(
  texts: string[],
  purpose: EmbedPurpose = 'document',
): Promise<Embedding[]> {
  const model = activeEmbeddingModel();

  // Only Cohere has a batch endpoint here, and only when it is the model actually in play.
  if (model !== config.cohereEmbedModelId) {
    const results: Embedding[] = [];
    for (const text of texts) results.push(await embed(text, purpose));
    return results;
  }

  const results = new Array<Embedding | undefined>(texts.length);
  const pending: { index: number; text: string }[] = [];

  for (let i = 0; i < texts.length; i += 1) {
    const trimmed = texts[i].trim();
    if (!trimmed) throw new Error('Cannot embed empty text');

    const key = `${model}:${purpose}:${trimmed}`;
    const hot = cache.get(key);
    if (hot) {
      results[i] = { vector: hot, model };
      continue;
    }

    const persisted = await readCache(`${model}#${purpose}`, trimmed);
    if (persisted) {
      cache.set(key, persisted);
      results[i] = { vector: persisted, model };
      continue;
    }

    pending.push({ index: i, text: trimmed });
  }

  for (let start = 0; start < pending.length; start += COHERE_MAX_BATCH) {
    const slice = pending.slice(start, start + COHERE_MAX_BATCH);
    const vectors = await cohereEmbedMany(
      slice.map((p) => p.text),
      purpose,
    );

    for (let j = 0; j < slice.length; j += 1) {
      const { index, text } = slice[j];
      const vector = vectors[j];
      cache.set(`${model}:${purpose}:${text}`, vector);
      void writeCache(`${model}#${purpose}`, text, vector);
      results[index] = { vector, model };
    }
  }

  return results.map((r, i) => {
    if (!r) throw new Error(`Embedding missing for text at index ${i}`);
    return r;
  });
}

/** Test seam — the in-process cache and fallback latches are module-global. */
export function resetEmbeddingCache(): void {
  cache.clear();
  autoUseLocalOnly = false;
  autoSkipTitan = false;
}

/** L2 distance between two vectors — mirrors what CockroachDB's <-> operator computes. */
export function l2Distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}
