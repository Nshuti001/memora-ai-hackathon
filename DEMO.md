# Demo video script

Under 3 minutes. Show the product working **and** show CockroachDB doing the work — early, not in a
closing montage. Upload to YouTube or Vimeo, set to **public**, paste the link into Devpost. No
copyrighted music.

Everything is deployed. **You do not need to run anything locally.** One browser tab:

**https://d275lpbrornn20.cloudfront.net**

---

## Do this 10 minutes before you hit record

Open the site, click **Get Started**, make an account with any email. Then type these three lines
into the chat, one at a time, and wait for each reply:

```
our data retention policy is sixty days for customer records
```
```
always run the database migrations before deploying to production
```
```
we shipped the distributed vector index yesterday afternoon
```

That's it. **Now wait at least 6 minutes before recording.** This matters: the Time Travel beat
compares "now" against "5 minutes ago", so the original retention fact has to be older than five
minutes for the change to show up. Waiting now means no dead air on camera.

While you wait: close other tabs, set the browser to about 1440×900, and pick light or dark mode —
both look right, just be consistent.

---

## Say this once, near the start

> "One thing up front: our AWS Bedrock account has a zero token quota, so Claude can't run. What
> you're about to see uses no language model at all — and that turned out to be the interesting
> part, because none of what makes this a *memory* needs one."

Don't apologise for it or dwell. One sentence, then move.

---

## 0:00 — The problem

> "Every AI agent forgets everything when the session ends. Memora is a memory layer where
> CockroachDB isn't storage bolted onto an agent — it *is* the memory."

On screen: the dashboard. Let the counters and the memory composition panel show.

## 0:20 — It recalls by meaning

Type into the chat:

```
how should I deploy?
```

Point at the answer — it returns the migrations rule you taught earlier.

> "I never said the word 'migrations' in that question. That's an approximate-nearest-neighbour
> search over a CockroachDB vector index, and that number is the real distance."

## 0:45 — It knows what kind of memory each thing is

Point at the **Memory Composition** panel: episodic, semantic, procedural, with counts.

> "Those three facts were sorted into three memory types automatically, each with its own importance
> and its own decay rate. With no model running — that classification is language rules, which is
> exactly why the demo still has memory types with Claude switched off."

## 1:05 — Search, to show the speed

Type into the search box on the right:

```
how do I undo a broken release
```

> "Nothing in that sentence matches the stored text. It finds the rollback procedure anyway, in
> about twenty milliseconds."

## 1:25 — Correct it, and watch supersession

Back in the chat:

```
actually the retention policy is now ninety days after the compliance audit
```

Read the reply out — it says the old memory is **superseded, not deleted**, and that a `supersedes`
edge now joins the two.

> "Nothing was overwritten. The old belief is still on disk. That's what makes the next part
> possible."

## 1:45 — Time travel (this is the differentiator)

Click **Time Travel**. Type `retention policy`, choose **5 minutes ago**, run it.

Three groups appear. Point at each:

- **Changed** — "sixty days", what it used to believe
- **Learned** — "ninety days", what it believes now
- **Unchanged** — the other two facts, untouched

> "CockroachDB is MVCC, so superseded row versions are already on disk. This is `AS OF SYSTEM TIME`
> reading the agent's actual former belief state — not a reconstruction. No history table, no
> snapshots, no extra write."

Then the line that lands it:

> "That's the question an audit actually asks. Not what does it know — what changed, and when."

## 2:15 — The graph

Click **Graph**.

> "Typed edges the agent can walk. The red one is the supersession we just created."

## 2:30 — Close

> "One hundred and twenty-two tests, all passing — thirty-nine of them need no database and no AWS
> account, so you can clone it and run them right now. Memora AI: memory that remembers what it used
> to know."

---

## If something goes wrong mid-take

- **Chat replies slowly the first time** — that's a Lambda cold start, about a second. Re-ask and it's
  instant.
- **Time Travel shows nothing under Changed** — the original fact wasn't old enough. Wait a few more
  minutes and run it again, or pick "1 hour ago" if you set up long enough ago.
- **The agent says it can't store something** — it refuses to write when embeddings are unavailable
  rather than save a memory it could never find again. Rare, but if it happens, say that out loud;
  it's a deliberate behaviour, not a bug.

## Optional extra shot, if you want a SQL beat

Only if you're comfortable and have time. Otherwise skip it — the dashboard already proves the point.

```sql
SELECT id, kind, content, importance FROM memories ORDER BY created_at DESC LIMIT 3;
```
