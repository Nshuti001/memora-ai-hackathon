# Setup — accounts and credentials

**You do not need any of this to run the project.** The whole memory layer — schema, vector index, time
travel, consolidation, decay, the dashboard — runs against a local CockroachDB with an offline
embedding provider. If you just want to see it work:

```bash
cockroach start-single-node --insecure --listen-addr=localhost:26257
cockroach sql --insecure -e 'CREATE DATABASE memora_dev'

cd server && npm install
cp .env.example .env
# set DATABASE_URL=postgresql://root@localhost:26257/memora_dev?sslmode=disable
# set EMBEDDING_PROVIDER=local
npm run db:migrate && npm run db:seed && npm run dev
```

The accounts below are what a full deployment needs: real Bedrock embeddings, Claude reasoning, and a
public URL. None of these steps can be automated — they need a human to accept terms and enter
details. Budget about 45 minutes, most of it waiting for approvals.

---

## 1. CockroachDB Cloud (~10 min)

1. Go to <https://cockroachlabs.cloud> and click **Sign up**. A free-tier ("Basic") cluster is enough for
   the hackathon and needs no credit card.
2. Create a cluster. Pick the AWS provider and a region close to where you will run Lambda — use
   `us-east-1` unless you have a reason not to, since keeping the database and Lambda in the same region
   keeps recall latency low and avoids cross-region data transfer charges.
3. On the cluster page, click **Connect**, choose **General connection string**, and copy it. It looks like:

   ```
   postgresql://<user>:<password>@<host>:26257/<db>?sslmode=verify-full
   ```

4. Put that string in `server/.env` as `DATABASE_URL` (see `server/.env.example`). Never commit it —
   `.env` is already in `.gitignore`.

Free-tier eligibility and usage limits are set by Cockroach Labs and can change; the hackathon rules make
each team responsible for reviewing the current terms and for any usage above the free tier.

### Also enable the Managed MCP Server

This is one of the two CockroachDB tools our submission claims, so don't skip it. In the Cloud Console,
open your cluster and find the **MCP Server** section. It generates a config snippet pointing at
`https://cockroachlabs.cloud/mcp`. Copy the API key it gives you into `.env` as `COCKROACH_MCP_API_KEY`.
Our `.mcp.json` at the repo root is already written to consume it in read-only mode.

## 2. AWS account (~15 min, plus possible verification delay)

1. Go to <https://aws.amazon.com/free> and create an account. This requires a credit card for identity
   verification even on the free tier, and phone verification. Account activation is usually instant but
   can take a few hours — **this is the step most likely to block you, so do it first.**
2. Once active, create an IAM user for local development rather than using the root account:
   IAM → Users → Create user → attach `AmazonBedrockFullAccess` and `AWSLambda_FullAccess`.
3. Create an access key for that user (Security credentials → Create access key → "Command Line Interface").
4. Put the key ID and secret into `server/.env` as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and set
   `AWS_REGION=us-east-1`.

## 3. Amazon Bedrock models — mostly automatic now

**The old "request model access" step no longer exists.** AWS retired the Model access page (verified in
the console on 2026-08-07). Serverless foundation models are enabled automatically across commercial
regions the first time your account invokes them, so there is nothing to submit and nothing to wait for.

Two things still to know:

- **Anthropic models may ask first-time users for use-case details.** If a Claude call is rejected the
  first time, the console will tell you what to fill in. Amazon's own models (Titan embeddings) have no
  such step.
- **Claude Sonnet 4.6 uses a Global inference profile.** In the Bedrock console this shows as
  **Global**, not Southeast / APAC. That is expected and correct — "Global" is a routing profile, not
  a region. Set:
  - `AWS_REGION=us-east-1` (a real region — never the string `global`; match your CockroachDB region)
  - `BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6` (Global CRIS profile ID — required for
    on-demand Claude; bare `anthropic.claude-sonnet-4-6` returns a ValidationException)
  - Titan embeddings: `amazon.titan-embed-text-v2:0` (no `global.` prefix)
- **Client:** `agent.ts` uses classic `AnthropicBedrock` (Bedrock Runtime), not the Mantle endpoint.
  Mantle returned 404 for every model ID on this setup; Runtime + the global profile works.
- **Free-tier / new-account quotas:** Many brand-new AWS accounts ship with Bedrock on-demand
  tokens-per-day effectively at **0**. Every Claude call then returns
  `ThrottlingException: Too many tokens per day` even on the first request — this is an **account
  quota**, not a Memora bug, and it will not fix itself by waiting a few minutes.

  Fix (use the AWS root / admin user in the console):
  1. Open [Bedrock Service Quotas](https://console.aws.amazon.com/servicequotas/home/services/bedrock/quotas)
  2. Search for **tokens per day** / **On-demand** for Anthropic Claude Sonnet (and embeddings if needed)
  3. Request an increase (50,000 TPD is plenty for the hackathon)
  4. Or open a free **Basic Support** case:
     <https://support.console.aws.amazon.com/support/home#/case/create>
     Subject: `Bedrock ThrottlingException Too many tokens per day on new account`

  Probe anytime with: `cd server && node scripts/check-bedrock.mjs`

  While blocked, Memora still stores and recalls in CockroachDB (memory-only mode). Once the quota
  lifts, Claude Sonnet 4.6 takes over automatically — no code change.

If a model turns out not to be available in your region, check which regions carry it in the new Bedrock
console and set `AWS_REGION` accordingly — but keep the CockroachDB cluster in the same region if you can,
since cross-region round trips dominate recall latency.

---

## Verifying it all works

Once `server/.env` is filled in:

```bash
cd server && npm install && npm run db:migrate && npm run verify
```

`db:migrate` creates the schema and the distributed vector index. `verify` does a live round trip: it
embeds a sentence through Bedrock, writes it to CockroachDB, reads it back by semantic search, and prints
the measured latency. If that prints numbers, every credential is correct and you can start building.

## What goes in .env

See `server/.env.example` for the complete list. Nothing in this repo hardcodes a credential, and nothing
in the frontend ever sees the database — the browser talks only to our API, which holds the connection.
