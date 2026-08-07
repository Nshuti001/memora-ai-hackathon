-- Memora AI — agentic memory schema for CockroachDB
--
-- Design notes that matter for correctness:
--
--   * Embeddings are VECTOR(1024) because Amazon Titan Text Embeddings V2 returns 1024 dimensions
--     by default. Changing EMBED_DIM in embeddings.ts means changing this column too.
--
--   * CockroachDB only accelerates L2 distance (<->) with a vector index; cosine (<=>) and inner
--     product (<#>) fall back to a full scan. We normalize every embedding to unit length before
--     writing, which makes L2 ordering identical to cosine ordering, so we get cosine semantics at
--     index speed. See toUnitVector() in embeddings.ts — that normalization is load-bearing, not
--     cosmetic.
--
--   * The vector index is prefixed by tenant_id. CockroachDB partitions the ANN search by the prefix
--     column, so one tenant's recall never scans another tenant's vectors. That is both the
--     performance story and the isolation story.

CREATE TABLE IF NOT EXISTS agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   STRING NOT NULL,
  name        STRING NOT NULL,
  description STRING NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  STRING NOT NULL,
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title      STRING NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  INDEX sessions_by_agent (tenant_id, agent_id, started_at DESC)
);

-- The memory store itself.
--
-- kind distinguishes the three memory types the agent reasons about differently:
--   episodic   — something that happened in a conversation ("user asked about X on Tuesday")
--   semantic   — a durable fact distilled from episodes ("user prefers phased rollouts")
--   procedural — a learned how-to ("to deploy, run make release then tag")
CREATE TABLE IF NOT EXISTS memories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         STRING NOT NULL,
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id        UUID REFERENCES sessions(id) ON DELETE SET NULL,

  kind              STRING NOT NULL DEFAULT 'episodic',
  content           STRING NOT NULL,
  embedding         VECTOR(1024) NOT NULL,

  -- importance drives what survives consolidation; confidence drops when a newer memory
  -- contradicts this one rather than deleting it outright, so the history stays auditable.
  importance        FLOAT8 NOT NULL DEFAULT 0.5,
  confidence        FLOAT8 NOT NULL DEFAULT 1.0,

  tags              STRING[] NOT NULL DEFAULT ARRAY[],
  metadata          JSONB NOT NULL DEFAULT '{}',

  access_count      INT8 NOT NULL DEFAULT 0,
  last_accessed_at  TIMESTAMPTZ,

  -- Soft supersession. A corrected memory points at the memory that replaced it; recall filters
  -- these out but the row stays for audit and rollback.
  superseded_by     UUID REFERENCES memories(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT importance_range CHECK (importance >= 0 AND importance <= 1),
  CONSTRAINT confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT kind_known CHECK (kind IN ('episodic', 'semantic', 'procedural')),

  INDEX memories_recent (tenant_id, agent_id, created_at DESC),
  INDEX memories_live (tenant_id, agent_id, superseded_by) STORING (kind, importance),
  INVERTED INDEX memories_tags (tags)
);

-- The distributed vector index. Prefixed by (tenant_id, agent_id) so an ANN search is scoped to one
-- agent's memories inside one tenant — every recall constrains both with equality, which is what lets
-- CockroachDB use the prefix rather than searching the whole table.
--
-- vector_l2_ops is the default and the only opclass CockroachDB accelerates; see the normalization
-- note at the top of this file for why L2 gives us cosine semantics here.
CREATE VECTOR INDEX IF NOT EXISTS memories_embedding_idx
  ON memories (tenant_id, agent_id, embedding);

-- Extend MVCC retention on the memories table to 7 days.
--
-- This is what makes time-travel recall possible. CockroachDB keeps superseded row versions until
-- garbage collection, so `SELECT ... AS OF SYSTEM TIME` can reconstruct exactly what the agent
-- believed at any past instant — with no history table, no snapshots, and no extra write cost. The
-- cluster default is 4 hours, which is too short to answer "what did you think last Tuesday?".
--
-- Cost: a longer window retains more old versions on disk. 7 days is a deliberate trade — long
-- enough to audit a week of agent behaviour, short enough not to grow unboundedly.
--
-- On some CockroachDB Cloud tiers zone configuration is managed for you and this statement is
-- rejected; the migration treats that as non-fatal and time travel still works within the cluster
-- default window.
ALTER TABLE memories CONFIGURE ZONE USING gc.ttlseconds = 604800;

-- Typed edges between memories. This is what makes the knowledge graph a real graph rather than a
-- drawing: consolidation writes 'supersedes' and 'derived_from' edges as it runs.
CREATE TABLE IF NOT EXISTS memory_links (
  tenant_id  STRING NOT NULL,
  src_id     UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  dst_id     UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation   STRING NOT NULL,
  weight     FLOAT8 NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, src_id, dst_id, relation),
  CONSTRAINT no_self_link CHECK (src_id != dst_id),
  INDEX links_by_dst (tenant_id, dst_id)
);

-- Additive columns, kept separate from CREATE TABLE so re-running the migration on an existing
-- cluster picks them up. CockroachDB applies these as online schema changes — no table lock, no
-- downtime, which is the point of running an agent's memory on a distributed SQL store.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS shared BOOL NOT NULL DEFAULT false;

-- Shared memories are readable by every agent in the tenant, so a second index without agent_id in
-- the prefix serves cross-agent recall. Keeping it separate from memories_embedding_idx means normal
-- per-agent recall is never slowed down by memories belonging to other agents.
CREATE VECTOR INDEX IF NOT EXISTS memories_shared_embedding_idx
  ON memories (tenant_id, shared, embedding);

-- Which model produced each embedding.
--
-- This is a correctness invariant, not bookkeeping. Vectors from different models occupy different
-- spaces: a Titan vector and a lexical-fallback vector of the *same sentence* are unrelated points,
-- so comparing them with <-> returns noise rather than an error. Recall therefore filters on this
-- column, and a store holding two models simply reports the mismatch instead of quietly ranking
-- garbage. Without it, one throttled embedding call silently corrupts every future search.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_model STRING NOT NULL DEFAULT 'unknown';

-- Persistent embedding cache.
--
-- Embeddings are deterministic and expensive: the same text always maps to the same vector, and on
-- Bedrock's free tier a daily token quota is easy to exhaust. Caching them in CockroachDB — the same
-- transactional store the memories live in — means each distinct string is embedded exactly once
-- ever, across process restarts and across every Lambda instance. A repeated demo query costs zero
-- Bedrock tokens.
--
-- Keyed by (model, text) because a cache that ignored the model would serve a lexical vector to a
-- Titan query, which is the exact corruption the embedding_model column exists to prevent.
CREATE TABLE IF NOT EXISTS embedding_cache (
  model        STRING NOT NULL,
  text_sha256  STRING NOT NULL,
  embedding    VECTOR(1024) NOT NULL,
  hits         INT8 NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model, text_sha256)
);

-- Fixed-window rate-limit counters, shared across every API instance.
--
-- This lives in the database rather than in process memory because an in-process limiter grants the
-- full quota independently in every Lambda execution environment — with N warm instances the real
-- limit becomes N times the configured one, which is the same as having no limit.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          STRING NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INT8 NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Every recall and write is logged. This is the observability surface the dashboard reads, and it is
-- what lets us answer "why did the agent say that?" after the fact.
CREATE TABLE IF NOT EXISTS memory_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    STRING NOT NULL,
  agent_id     UUID,
  operation    STRING NOT NULL,
  query        STRING,
  result_ids   UUID[] NOT NULL DEFAULT ARRAY[],
  latency_ms   INT8,
  token_cost   INT8,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX audit_recent (tenant_id, created_at DESC)
);
