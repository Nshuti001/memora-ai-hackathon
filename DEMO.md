# Demo video script

The rules require a video **under 3 minutes** that shows the project working **and** shows the
CockroachDB memory layer at work. Judges are not required to watch past three minutes, so the
CockroachDB proof has to land early — not in a closing montage.

Upload to YouTube or Vimeo, set to public, and put the link on the Devpost form. No copyrighted music.

## Before recording

```bash
# Fresh, predictable data
cd server
npm run db:migrate
npm run db:seed
npm run dev

# Second terminal — frontend
cd .. && npm run dev

# Third terminal, kept visible for the SQL beat
cockroach sql --url "$DATABASE_URL"
```

Browser at 1440×900. Close other tabs. Have the SQL terminal ready on a second window you can cut to.

---

## 0:00–0:20 — The problem, stated once

> "Every AI agent forgets everything the moment the session ends. Memora fixes that: it's a memory
> layer where CockroachDB isn't storage bolted onto an agent — it *is* the memory."

On screen: the dashboard, already seeded. Let the live numbers show — 16 memories, memory composition,
recall latency.

## 0:20–0:55 — It actually remembers

Type into the chat:

> `I always deploy on Fridays and I need zero-downtime migrations.`

Show the tool chips appearing (`save_memory`) and the reply streaming in.

Then, **in the same breath**, ask something worded completely differently:

> `When is it safe for me to ship code?`

Point at the `recalled` chips under the answer.

> "It didn't keyword-match 'ship' to 'deploy'. That's an approximate-nearest-neighbour search over a
> CockroachDB vector index — and those little chips are the actual memory rows it consulted."

## 0:55–1:25 — The CockroachDB memory layer, on screen

**This is the beat the rules require. Do not skip it.** Cut to the SQL terminal:

```sql
-- The memory the agent just wrote, with its vector
SELECT id, kind, content, importance
  FROM memories ORDER BY created_at DESC LIMIT 3;

-- And proof the vector index is doing the work
EXPLAIN
SELECT id, content FROM memories
 WHERE tenant_id = 'demo' AND agent_id = '<id>'
   AND superseded_by IS NULL AND archived_at IS NULL
 ORDER BY embedding <-> (SELECT embedding FROM memories LIMIT 1)
 LIMIT 5;
```

Point at the plan:

> "`vector search`, on `memories@memories_embedding_idx`, with prefix spans scoping it to this tenant
> and agent. One agent's recall physically cannot scan another tenant's vectors."

## 1:25–1:55 — Time travel (the differentiator)

Back in the dashboard, Time Travel tab. Query `retention policy`, compare against 1 hour ago.

> "CockroachDB is MVCC, so superseded row versions are already on disk. This is `AS OF SYSTEM TIME` —
> the agent's actual former belief state, not a reconstruction. No history table. No snapshots. No
> extra write cost."

Show the three groups: learned, changed, unchanged.

> "That's the question an audit actually asks: not what does it know, but what changed and when."

## 1:55–2:20 — Consolidation and the graph

Press **Consolidate**.

> "Four separate episodes about the GraphQL migration just became one durable fact — and the
> generalization keeps `derived_from` edges back to its evidence, so it's auditable."

Switch to the Graph tab.

> "Red arrow is a correction superseding an older belief. Dashed node is the belief it replaced —
> kept, not deleted. Green is consolidation. Dotted is semantic similarity pulled live from the
> vector index."

## 2:20–2:45 — It's a real system

Fast cuts:

- `npm test` → **66 passing**
- `/api/metrics` → p50/p95/p99 per operation
- `scripts/ccloud-ops.sh preflight` → cluster, backups, network, retention

> "Sixty-six tests. Tenant isolation, injection resistance on the time-travel path, and the
> normalization property the vector index depends on are all covered."

## 2:45–3:00 — Close

> "Four CockroachDB tools: distributed vector indexing, MVCC time travel, the Managed MCP Server, and
> the ccloud CLI — plus Claude and Titan on Bedrock, running on Lambda. Memora AI. Every agent
> remembers."

---

## Devpost submission text

**Elevator pitch (one line)**
Persistent, auditable memory for AI agents — where CockroachDB's vector index *is* the memory, and
MVCC lets you ask what the agent believed last Tuesday.

**Inspiration**
Every agent framework we tried had the same hole: the agent is brilliant for one session and a
stranger the next. Bolting a vector database onto a SQL database creates a second problem — the
embedding and the fact it describes drift apart, and nothing tells you they have.

**What it does**
Memora stores every fact an agent learns as a vector in CockroachDB and recalls it by meaning across
sessions. It distinguishes episodic, semantic and procedural memory; deduplicates restatements;
supersedes corrections instead of deleting them; consolidates related episodes into durable facts;
and lets unused memories decay. Because CockroachDB is MVCC, it can also read its own past: ask what
it believed an hour or a week ago and get the real former belief state.

**How we built it**
CockroachDB Cloud holds memories and their 1024-dimension Titan V2 embeddings in one transactional
store, indexed with a distributed vector index prefixed by `(tenant_id, agent_id)`. Claude on Bedrock
drives a five-tool agent loop over that memory. AWS Lambda hosts the API; S3 and CloudFront serve the
dashboard. We used the Managed MCP Server to inspect the live cluster read-only during development,
and the ccloud CLI for control-plane operations.

**Challenges**
CockroachDB only accelerates L2 distance, so cosine similarity would have silently fallen back to a
full scan — we normalize every embedding to unit length, which makes L2 ordering equal cosine
ordering and keeps the index in play. `AS OF SYSTEM TIME` also rejects bound parameters, forcing
string interpolation on a user-supplied timestamp; that path is guarded by a strict allowlist with
injection attempts in the test suite.

**What we learned**
That memory is a data-modelling problem more than a retrieval one. Deduplication, supersession,
consolidation and decay did more for answer quality than any change to the similarity search.

**What's next**
Multi-region deployment with follower reads for analytics, and letting the agent schedule its own
consolidation instead of waiting for a cron.

---

## Submission checklist

- [ ] Public repo with the MIT LICENSE visible in the GitHub About sidebar
- [ ] README explains setup, run steps, and which CockroachDB and AWS tools were used
- [ ] Working demo URL, free and unrestricted until judging ends **September 15, 2026**
- [ ] Video under 3:00, public on YouTube or Vimeo, showing the app *and* the CockroachDB layer
- [ ] Text description of features and functionality
- [ ] CockroachDB tools identified: vector indexing, MVCC time travel, MCP Server, ccloud CLI
- [ ] AWS services identified: Bedrock (Claude + Titan), Lambda, S3, CloudFront
- [ ] Architecture diagram included (README)
- [ ] Bolt scaffold disclosed as pre-existing generated work
- [ ] CockroachDB cluster left running — a paused free-tier cluster makes the demo look broken
