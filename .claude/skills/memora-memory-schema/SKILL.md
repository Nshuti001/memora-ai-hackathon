---
name: memora-memory-schema
description: Query, extend, and debug Memora's CockroachDB agent-memory schema. Use when writing SQL against memories/memory_links/memory_audit, adding a column, changing an index, or investigating why recall returned the wrong rows.
---

# Memora memory schema

The schema lives in `server/src/schema.sql`. Read it before writing any query — the rules below are
the ones that are easy to get wrong and expensive to get wrong.

## The live-memory filter is not optional

A memory is **live** only when both conditions hold:

```sql
superseded_by IS NULL AND archived_at IS NULL
```

`superseded_by` means a correction replaced it. `archived_at` means decay retired it. A query that
checks only one of them silently resurrects beliefs the agent has already corrected — the worst
failure this system has, because the agent then asserts a stale fact with full confidence.

In application code this predicate is the `LIVE` constant in `server/src/memory.ts`. Use it rather
than retyping the condition.

## Vector search: only L2 is accelerated

CockroachDB accelerates **only** `<->` (L2 distance). Writing `<=>` (cosine) or `<#>` (inner product)
against a vector index silently falls back to a full scan — same results, orders of magnitude slower,
no warning.

Every embedding is normalized to unit length before it is written (`toUnitVector` in
`server/src/embeddings.ts`). On unit vectors L2 ordering equals cosine ordering, so `<->` gives
cosine semantics at index speed. **If you add a code path that writes embeddings, it must normalize.**

## Getting the index actually used

The index is `memories_embedding_idx ON memories (tenant_id, agent_id, embedding)`. CockroachDB uses
it only when the prefix columns are constrained by equality **and** the query orders by the distance
operator with a LIMIT:

```sql
SELECT id, content, embedding <-> $3 AS distance
  FROM memories
 WHERE tenant_id = $1 AND agent_id = $2 AND superseded_by IS NULL AND archived_at IS NULL
 ORDER BY embedding <-> $3
 LIMIT 20;
```

Verify with `EXPLAIN`. A healthy plan contains:

```
• vector search
    table: memories@memories_embedding_idx
    prefix spans: [/'tenant'/'agent-uuid' - /'tenant'/'agent-uuid']
```

If you instead see `• filter` over a `• scan`, the index is not being used — usually because a prefix
column was left unconstrained, or the ORDER BY expression does not textually match the SELECT one.

Cross-agent recall of shared memories uses the second index,
`memories_shared_embedding_idx ON memories (tenant_id, shared, embedding)`. That is why sharing is a
boolean column rather than a join table: a join could not participate in the index prefix.

## Adding a column

Use additive statements at the bottom of `schema.sql` rather than editing the `CREATE TABLE`:

```sql
ALTER TABLE memories ADD COLUMN IF NOT EXISTS my_column STRING;
```

The migration re-runs top to bottom on every deploy, so `CREATE TABLE IF NOT EXISTS` will not pick up
a new column on an existing cluster. CockroachDB applies these as online schema changes — no table
lock, no downtime.

## Time travel

`AS OF SYSTEM TIME` reads a past database state, bounded by `gc.ttlseconds` (raised to 7 days on the
`memories` table). Two rules:

1. **CockroachDB rejects bound parameters after `AS OF SYSTEM TIME`.** It accepts only constant
   expressions, which forces interpolation. Never interpolate a caller-supplied value directly —
   always go through `asOfClause()` in `server/src/time-travel.ts`, which allowlists three exact
   shapes. This is the only barrier against SQL injection on that path.
2. It composes with the vector index, so historical recall is still an indexed ANN search.

## Serializable retries are normal

CockroachDB runs `SERIALIZABLE`. A transaction that loses a conflict aborts with SQLSTATE `40001` and
is **expected** to be retried — it is an outcome, not a bug. Every write goes through
`withTransaction()` in `server/src/db.ts`, which retries with exponential backoff and jitter. Do not
open raw transactions that bypass it.

## Debugging recall that returns the wrong rows

Work down this list in order:

1. **Nothing comes back at all.** Check the embedding width matches the column: `EMBED_DIM` in
   `embeddings.ts` against `VECTOR(1024)` in the schema. A mismatch errors at write time, so if
   writes succeed the widths agree.
2. **Everything scores about the same.** The vectors are probably not normalized. Check
   `SELECT vector_norm(embedding) FROM memories LIMIT 5` — every value should be ~1.0.
3. **Results are relevant but ranked oddly.** Ranking is not pure similarity: `scoreOf()` blends
   similarity 70%, importance 20%, recency 10% with a 30-day half-life. An old, unimportant, highly
   similar memory can lose to a fresher one.
4. **Corrected facts keep reappearing.** A query is missing half the `LIVE` predicate.
5. **A tenant sees another tenant's data.** The tenant must come from the API key, never the request
   body. Check `tenantOf()` in `server/src/api.ts`.

## Threshold constants are per-embedding-provider

`config.thresholds` holds `nearDuplicate` and `cluster` distances, calibrated separately for Bedrock
Titan and for the local lexical provider — the two put "the same fact restated" at genuinely
different distances. Do not hardcode a distance in new code; read it from config.
