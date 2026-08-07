import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Always load server/.env from this package, regardless of process.cwd(). Starting the API from the
// repo root (or a process manager) used to silently skip credentials and fall into memory-only mode.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy server/.env.example to server/.env and ` +
        `fill it in — see SETUP.md for where each value comes from.`,
    );
  }
  return value;
}

/**
 * Which model turns text into vectors.
 *
 *   'bedrock' — Amazon Titan Text Embeddings V2 (1024 dims).
 *   'cohere'  — Cohere Embed v3 on Bedrock (1024 dims). Real semantics, and on a new AWS account it
 *               is frequently the only embedding model with any on-demand quota granted.
 *   'local'   — deterministic offline stand-in; lexical overlap only, no credentials. Tests and
 *               local development.
 *   'auto'    — Titan, then Cohere, then local. Each step is a genuine downgrade in quality, so the
 *               model that actually produced a vector is recorded with it (see embedding_model).
 */
export type EmbeddingProvider = 'bedrock' | 'cohere' | 'local' | 'auto';

const embeddingProviderRaw = (process.env.EMBEDDING_PROVIDER ?? 'auto').toLowerCase();
const embeddingProvider: EmbeddingProvider = (
  ['bedrock', 'cohere', 'local', 'auto'] as const
).includes(embeddingProviderRaw as EmbeddingProvider)
  ? (embeddingProviderRaw as EmbeddingProvider)
  : 'auto';

/**
 * Distance thresholds are a property of the embedding space, not of the memory logic — two providers
 * put "the same fact restated" at genuinely different L2 distances, so a single hardcoded constant is
 * correct for at most one of them.
 *
 * Measured on unit vectors, where the maximum possible distance is 2 and orthogonal is sqrt(2)≈1.414:
 *
 *   bedrock (Titan V2)  paraphrase ≈0.2-0.4,  same topic ≈0.4-0.6,  unrelated >0.9
 *   local (lexical)     paraphrase ≈0.0-0.5,  same topic ≈0.85-1.05, unrelated =1.414 exactly
 *                       (exactly sqrt(2) because two sentences with no shared terms hash to
 *                       disjoint buckets, making the vectors strictly orthogonal)
 *
 * The local provider's band is compressed against the top of the range because it only sees lexical
 * overlap. Reusing Titan's 0.55 cluster threshold there finds no clusters at all.
 */
const THRESHOLDS = {
  bedrock: { nearDuplicate: 0.35, cluster: 0.55 },
  // Cohere v3, measured on this project's own sentences (not estimated):
  //   identical 0.000 · distinct episodes on one topic 0.595-0.632 · paraphrase 0.692
  //   same topic 1.038 · related domain 1.096 · unrelated 1.129
  //
  // Cohere's band is compressed at the top, and that forces a real trade: a paraphrase (0.692) sits
  // *further* apart than two genuinely distinct episodes about one topic (0.595). No single
  // near-duplicate threshold can both merge paraphrases and keep those episodes separate, so we take
  // the conservative side — 0.45 merges only near-identical text. Duplicates degrade recall;
  // wrongly merging two distinct facts destroys one of them, which is not recoverable.
  //
  // The cluster threshold sits at 0.90: above the 0.632 episode spread so consolidation still groups
  // them, well below the 1.129 unrelated floor so it never pulls in an unrelated memory.
  cohere: { nearDuplicate: 0.45, cluster: 0.90 },
  local: { nearDuplicate: 0.35, cluster: 1.15 },
  // auto may serve any of the three in one process; use the loosest cluster threshold so
  // consolidation still finds groups after a fallback.
  auto: { nearDuplicate: 0.35, cluster: 1.15 },
} as const;

const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() || undefined;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || undefined;

export const config = {
  databaseUrl: required(
    'DATABASE_URL',
    // A local insecure cluster is the default so `npm test` works with no setup.
    process.env.NODE_ENV === 'test'
      ? 'postgresql://root@localhost:26257/memora_test?sslmode=disable'
      : undefined,
  ),

  // Must be a real AWS region (e.g. us-east-1). "global" is NOT a region — it is only a
  // prefix on Bedrock inference profile IDs like global.anthropic.claude-sonnet-4-6.
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  awsAccessKeyId,
  awsSecretAccessKey,
  embeddingProvider,
  // Thresholds for the preferred embedding space. When auto falls back, recall still works —
  // near-duplicate matching is slightly looser or tighter depending on the provider.
  thresholds: THRESHOLDS[embeddingProvider],

  // Claude Sonnet 4.6 is invoked via the Global cross-Region inference profile.
  // Bare anthropic.claude-sonnet-4-6 often 400s; use the profile ID with the global. prefix.
  modelId: process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6',
  embedModelId: process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0',
  cohereEmbedModelId: process.env.COHERE_EMBED_MODEL_ID ?? 'cohere.embed-english-v3',

  port: Number(process.env.PORT ?? 8787),

  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** Requests per minute per tenant. 0 disables the limiter. */
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
} as const;

export type Config = typeof config;
