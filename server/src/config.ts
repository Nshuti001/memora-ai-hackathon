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
 * 'bedrock' calls Amazon Titan Text Embeddings V2. 'local' uses the deterministic offline stand-in in
 * embeddings.ts, which needs no credentials — for tests and for developing against a local cluster.
 * 'auto' tries Bedrock first and falls back to local on throttle/outage so the memory layer keeps
 * working during free-tier quota exhaustion.
 */
const embeddingProviderRaw = (process.env.EMBEDDING_PROVIDER ?? 'auto').toLowerCase();
const embeddingProvider =
  embeddingProviderRaw === 'local'
    ? ('local' as const)
    : embeddingProviderRaw === 'bedrock'
      ? ('bedrock' as const)
      : ('auto' as const);

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
  local: { nearDuplicate: 0.35, cluster: 1.15 },
  // auto may serve Titan or local embeddings in one process; use the looser local cluster
  // threshold so consolidation still finds groups after a Titan → local fallback.
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
  // Thresholds for the preferred embedding space. When auto falls back to local, recall still
  // works — near-duplicate matching is slightly looser/tighter depending on the provider.
  thresholds: THRESHOLDS[embeddingProvider],

  // Claude Sonnet 4.6 is invoked via the Global cross-Region inference profile.
  // Bare anthropic.claude-sonnet-4-6 often 400s; use the profile ID with the global. prefix.
  modelId: process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6',
  embedModelId: process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0',

  port: Number(process.env.PORT ?? 8787),

  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** Requests per minute per tenant. 0 disables the limiter. */
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
} as const;

export type Config = typeof config;
