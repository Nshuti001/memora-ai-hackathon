# Devpost submission copy

The exact text for the Devpost form, kept here so it is version-controlled and can be re-pasted.

**Note on the Project details page:** `Video demo link` is a required field, and an empty one blocks
the whole form — including edits to the story. Paste the video URL first, then the story below, then
save. Without the video URL nothing on that page can be saved at all.

---

## Project name

```
Memora AI
```

## Elevator pitch (200 char limit)

```
Persistent memory for AI agents on CockroachDB and Amazon Bedrock — recall by meaning through a distributed vector index, and ask the agent what it believed last week via MVCC time travel.
```

## Built with

`cockroachdb`, `amazon-bedrock`, `aws-lambda`, `amazon-s3`, `amazon-cloudfront`, `claude`, `cohere`,
`typescript`, `node.js`, `react`, `vite`, `tailwindcss`, `sql`, `vector-search`, `mcp`

## Try it out

- Live demo: https://d275lpbrornn20.cloudfront.net
- Repository: https://github.com/Nshuti001/memora-ai-hackathon

---

## About the project

## Inspiration

An agent forgets everything the moment a session ends. The usual fix is to bolt a vector database
onto it and call that memory — but a vector index is a lookup table, and memory is not a lookup
table. Real memory consolidates, decays, corrects itself, and above all it has a **past**. You can
ask a person what they used to think.

So we wanted an agent you could ask: *what did you believe last Tuesday, and when did that change?*

It turned out CockroachDB could answer that almost for free. It is an MVCC store, so superseded row
versions are already on disk. `AS OF SYSTEM TIME` reads a past belief state exactly — no history
table, no snapshots, no extra write on the hot path. Every other memory layer we looked at can tell
you what an agent knows. This one can tell you what it *used to* know.

```
You:   What's our retention policy?
Agent: Ninety days, matching the compliance requirement.
You:   What did you think an hour ago?
Agent: Sixty days — that was raised after the audit. Before that I had thirty.
```

## What it does

Memora is a memory layer for autonomous agents, not a wrapper around a vector search. What makes it
a *memory*:

- **Three memory types** — `episodic` (what happened), `semantic` (durable facts), `procedural`
  (learned how-to). The agent chooses the kind when saving and filters by it when recalling.
- **Write-time deduplication** — a near-identical memory reinforces the existing row instead of
  inserting a new one. Without this, hearing the same preference ten times leaves ten rows and
  recall degrades into repetition.
- **Supersession, not deletion** — a correction sets `superseded_by` and writes a `supersedes` edge.
  Nothing is destroyed, which is what makes the past queryable.
- **Consolidation** — clusters related episodes and distills them into one semantic fact, linked by
  `derived_from` edges. Human memory generalizes episodes during sleep; without it the store only
  grows.
- **Decay** — importance falls with time since last access, damped by recall count. Semantic
  memories decay at a third the rate of episodic ones.
- **Reversible archival** — decayed memories leave recall but stay queryable and can be reinstated.
- **Ranked recall** — similarity 70%, importance 20%, recency 10% with a 30-day half-life.
  Similarity dominates on purpose: a relevant old memory should beat a fresh irrelevant one.
- **Time travel** — recall against a past state, diff what was learned versus what changed, and walk
  a supersession chain back to the original belief.
- **A memory graph** — typed edges (`supersedes`, `derived_from`, `similar_to`) the agent traverses.
- **Full audit trail** — every read and write lands in `memory_audit` with latency, so "why did the
  agent say that?" is answerable after the fact.

## How we built it — CockroachDB

The rules ask for at least two CockroachDB capabilities. We used four.

**1. Distributed vector indexing.** `memories.embedding` is a `VECTOR(1024)` column indexed by
`memories_embedding_idx`. Every recall is an approximate-nearest-neighbour search over that index.
Two decisions are load-bearing:

- The index is **prefixed by `(tenant_id, agent_id)`**, so CockroachDB partitions the ANN search by
  prefix and one agent's recall never scans another tenant's vectors. Isolation and performance come
  from the same mechanism rather than a `WHERE` clause applied afterwards. Verified, not assumed —
  `EXPLAIN` shows `vector search … prefix spans: [/'tenant'/'agent' - …]`.
- **Every embedding is normalized to unit length before it is written.** CockroachDB only
  index-accelerates L2 distance (`<->`); cosine silently falls back to a full scan. On unit vectors,
  L2 ordering *is* cosine ordering — cosine semantics at index speed. A test fails if that breaks.

**2. MVCC time travel.** The migration raises `gc.ttlseconds` on `memories` to 7 days, and three
endpoints read history: recall against a past state, a belief diff, and provenance via a recursive
CTE. The agent has a `recall_as_of` tool. Time travel composes with the vector index, so historical
recall is still an indexed ANN search. Because CockroachDB rejects bound parameters after
`AS OF SYSTEM TIME`, the single interpolation point is guarded by a strict three-shape allowlist with
ten injection attempts in the test suite.

**3. CockroachDB Cloud Managed MCP Server**, read-only, driven from Claude Code — used to inspect
what the agent actually stored, run `EXPLAIN` to confirm the vector index was used rather than
scanned, and measure recall latency against real data, without opening a write path into live memory.

**4. ccloud CLI + Agent Skills.** `scripts/ccloud-ops.sh` wraps the control plane for agent use
(`status`, `backups`, `backup-now`, `network`, `retention`, read-only `preflight`); every subcommand
emits JSON so an agent can parse it. Two portable Agent Skills encode what this project learned about
CockroachDB.

## How we built it — AWS

- **Amazon Bedrock** runs the agent loop (Claude Sonnet 4.6, five memory tools, streaming) and
  produces every embedding CockroachDB indexes — Titan Text Embeddings V2 and Cohere Embed v3, both
  at exactly 1024 dimensions, with automatic one-step demotion. Cohere is driven asymmetrically as
  designed: `search_document` for stored memories, `search_query` for questions. Each row records
  which model produced its vector, so two embedding spaces are never compared.
- **AWS Lambda** hosts the agent loop and memory API, with a module-scoped connection pool that
  survives across invocations.
- **API Gateway** is the public entry point, proxying to Lambda with payload format 2.0.
- **Amazon S3 + CloudFront** serve the dashboard; CloudFront also proxies `/api/*` to the HTTP API,
  so the browser sees one origin and CORS does not arise in production.

## Running it without a model

Our Bedrock account has a **zero on-demand quota on every chat model, in every region** — a
new-account restriction, not a misconfiguration. A signed request to the same endpoint returns 200,
so this is quota, not credentials. Rather than let that take the product down, the memory layer runs
on its own, and the live demo is currently serving that path.

That turned out to be the most interesting thing we built, because **none of what makes this a
memory needs an LLM.** Embedding, vector recall, deduplication, classification, supersession and time
travel are all database work. Only the conversational phrasing is Claude's.

So with the model gone, the agent keeps its behaviour and drops only the reasoning:

- **Statements are still classified** into episodic / semantic / procedural by language rules, which
  also set importance. Storing everything as `semantic` would have been easier and would have quietly
  deleted memory types from the demo.
- **Corrections still supersede.** "actually, retention is ninety days now" finds the nearest
  existing memory, marks it superseded, and writes a `supersedes` edge — so the graph and
  `AS OF SYSTEM TIME` still have something real to show.
- **Writes still refuse when they cannot be honest.** With embeddings unavailable, storing a memory
  would put a row in the table that vector recall could never retrieve, so it declines and says why.
- **Every such reply is labelled** "memory layer only — not model output", in the API payload and in
  the dashboard.

Those rules are covered by tests, because a regression there would leave the demo *looking* fine
while silently losing the two features it exists to demonstrate.

## Challenges we ran into

**Embedding-space corruption, found the hard way.** Our provider fallback silently wrote vectors from
a different model into the same column. Nothing errored — recall just quietly got worse. We proved it
by re-embedding a stored memory locally and measuring the distance to what was on disk: `0.0000`.
Vectors from different models are not comparable, so we added an `embedding_model` provenance column,
made recall filter on the active model, reported how many memories the active model *cannot* search,
and shipped a `db:reembed` command.

**Three bugs that only existed once deployed.** A throttled Bedrock call was retried with exponential
backoff, so a single message took **134 seconds** before the memory fallback even started — longer
than Lambda's timeout, so chat on the live site simply died. Capping retries and adding a circuit
breaker took the same seven-turn script from **15m42s to 8.2s**. Then every embedding on Lambda
failed with `UnrecognizedClientException`: Lambda injects the execution role's *temporary*
credentials as `AWS_ACCESS_KEY_ID`, our config preferred those over the long-term pair, and dropped
`AWS_SESSION_TOKEN` — signing with half a credential. Finally, supersession silently never fired in
production, because the distance ceiling was calibrated for near-identical text while a real
correction on Cohere sits around 1.0; it had been storing a second contradictory memory instead of
replacing the first.

**`AS OF SYSTEM TIME` rejects bound parameters.** CockroachDB accepts only constant expressions
there, which forces string interpolation — in the one place you least want it. `asOfClause()` is the
only barrier between caller input and query text, so it is a strict allowlist of three shapes.

**Getting a public front door at all.** A Lambda Function URL with `auth-type NONE` returns 403 on
this account regardless of its resource policy, and fronting it with a CloudFront Origin Access
Control failed too — CloudFront signs the origin request and the origin rejects the signature. API
Gateway is public by design, so nothing has to be signed.

**Decimal versus float.** CockroachDB's `extract(epoch …)` returns `DECIMAL`, and mixing it into the
decay expression fails with `unsupported binary operator: <float> * <decimal>`. Explicit `::FLOAT8`
casts throughout.

**Rate limiting cannot live in process.** An in-memory limiter grants the full quota independently in
every Lambda execution environment. It is a fixed-window counter in CockroachDB, shared by every
instance, and it fails open.

## Accomplishments that we're proud of

- Time travel that works end to end, exposed to the agent as a tool rather than just an endpoint.
- Tenant isolation derived from the API key, never from the request body — with a test that one
  signed-in user cannot see another's memories.
- **122 tests across 22 suites, all passing.** 39 need no database and no AWS account, so a reviewer
  can clone the repo and run a meaningful suite immediately.
- Honest failure modes. The dashboard labels degraded answers rather than dressing them up.
- A UI genuinely usable in light and dark mode on phone, tablet and desktop, verified for contrast
  and layout across every route rather than eyeballed.

## What we learned

That the interesting part of agent memory is not retrieval — it is everything around retrieval.
Deduplication, supersession, decay and consolidation are what separate a memory from a growing pile
of embeddings, and none of them are hard individually; they are just usually skipped.

And that a database's storage model can be a feature. We did not build time travel — CockroachDB's
MVCC already had it, and we exposed it. The best thing we shipped cost a `gc.ttlseconds` setting and
a strict input allowlist.

## What's next for Memora AI

- Restore Claude once the Bedrock quota case clears; the circuit breaker picks it up automatically.
- Re-embed onto Titan V2 using the provenance column and `db:reembed` path already built for it.
- Learned decay rates per memory type instead of hand-tuned constants.
- Multi-region memory, using CockroachDB's regional-by-row capabilities to keep recall local.
