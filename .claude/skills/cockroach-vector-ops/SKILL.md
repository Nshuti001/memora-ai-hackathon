---
name: cockroach-vector-ops
description: Operate and tune CockroachDB distributed vector indexes — verify an index is being used, measure recall latency, size the retention window, and diagnose slow ANN queries. Use for CockroachDB performance, index, or vector-search questions.
---

# Operating CockroachDB vector indexes

## Confirm the index exists

```sql
SHOW INDEXES FROM memories;
```

Look for `memories_embedding_idx`. Vector indexing requires CockroachDB v25.2 or later; on an older
cluster `CREATE VECTOR INDEX` fails as unimplemented and recall silently degrades to an exact scan —
correct results, but latency that grows linearly with the memory count.

## Confirm the index is actually used

This is the check that matters, and the one people skip. `EXPLAIN` the real recall query:

```sql
EXPLAIN
SELECT id, embedding <-> '[...]' AS d
  FROM memories
 WHERE tenant_id = 't' AND agent_id = 'a' AND superseded_by IS NULL AND archived_at IS NULL
 ORDER BY embedding <-> '[...]'
 LIMIT 6;
```

**Healthy:**

```
• vector search
    table: memories@memories_embedding_idx
    target count: 6
    prefix spans: [/'t'/'a' - /'t'/'a']
```

**Unhealthy** — a `• scan` with a `• sort` above it means every row is being read and sorted.

Common causes of a missed index:

| Symptom in the plan | Cause |
|---|---|
| No `prefix spans` line | A prefix column (`tenant_id` or `agent_id`) is not equality-constrained |
| `sort` above a full `scan` | `ORDER BY` expression does not textually match the one in `SELECT` |
| Index absent from `SHOW INDEXES` | Cluster predates v25.2, or the migration's vector step failed |
| Plan uses `memories_shared_embedding_idx` unexpectedly | The query constrains `shared` instead of `agent_id` |

## Measure recall latency honestly

```sql
SELECT operation,
       count(*)                                   AS calls,
       round(avg(latency_ms))                     AS mean_ms,
       max(latency_ms)                            AS max_ms
  FROM memory_audit
 WHERE created_at > now() - INTERVAL '1 hour'
 GROUP BY operation
 ORDER BY calls DESC;
```

Note this measures the **whole recall path**, including the embedding call to Bedrock — which
normally dominates. To isolate the database, compare against `EXPLAIN ANALYZE` on the same query
with a literal vector.

## Retention window for time travel

```sql
SHOW ZONE CONFIGURATION FOR TABLE memories;
```

`gc.ttlseconds` bounds how far back `AS OF SYSTEM TIME` can read. Memora sets 604800 (7 days). Raising
it retains more old row versions on disk; lowering it below ~600 risks breaking long-running
transactions. Some CockroachDB Cloud tiers manage zone configuration for you and reject the
statement — the migration treats that as a warning, and time travel still works within the cluster
default (4 hours).

## Follower reads for cheap historical queries

`AS OF SYSTEM TIME follower_read_timestamp()` serves a read (~4.8s stale) from the nearest replica
instead of the leaseholder. For analytics over the memory store — dashboards, aggregate stats,
anything that does not need this instant's data — this reduces latency and takes load off the
leaseholder. Never use it for a read that must reflect a write that just happened.

## Sizing an ANN search

`ORDER BY ... LIMIT n` sets the target count. Memora deliberately fetches `limit * 3` candidates and
re-ranks them in the application, because ranking blends similarity with importance and recency —
fetching exactly `limit` would let a marginally-closer but unimportant memory crowd out a better one.
Widening the multiplier improves ranking quality at linear cost in rows examined.

## Growth and cleanup

```sql
-- How much of the store is dead weight?
SELECT count(*) FILTER (WHERE superseded_by IS NOT NULL) AS superseded,
       count(*) FILTER (WHERE archived_at IS NOT NULL)   AS archived,
       count(*) FILTER (WHERE superseded_by IS NULL AND archived_at IS NULL) AS live
  FROM memories;
```

Superseded and archived rows are kept on purpose — they are what time travel and provenance read. If
they genuinely need to go, delete rows older than the retention window, never live ones:

```sql
DELETE FROM memories
 WHERE archived_at IS NOT NULL
   AND archived_at < now() - INTERVAL '30 days';
```

Run consolidation before considering deletion: it converts many episodic fragments into fewer
semantic facts, which usually shrinks the working set more than deleting would.
