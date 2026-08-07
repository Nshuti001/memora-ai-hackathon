# Deploying to AWS

Two pieces go up: the memory API onto Lambda, and the dashboard onto S3 behind CloudFront.

Prerequisites: AWS CLI v2 installed and configured (`aws configure`), and `server/.env` filled in
per [SETUP.md](SETUP.md).

## 1. The API — Lambda

```bash
cd server && ./deploy.sh
```

The script compiles TypeScript, installs production dependencies into a bundle, creates the IAM
execution role if it doesn't exist (basic Lambda logging plus `bedrock:InvokeModel`), and creates or
updates the function behind a public Function URL. It prints the URL when it finishes.

Two things worth knowing about how it handles configuration:

- **`.env` is never bundled into the deployment package.** Its contents are read and passed to Lambda
  as environment variables instead, so the database password does not end up inside a zip artifact
  sitting in S3.
- **The pg connection pool is module-scoped**, so it is created once per Lambda execution environment
  and reused across invocations. Reconnecting to CockroachDB on every request would dominate response
  time, and would burn through the cluster's connection limit under any real concurrency.

### Streaming in Lambda

`/api/chat/stream` returns server-sent events. A buffered Lambda invocation cannot flush
incrementally, so the frames are collected and returned in one body — the wire format is identical
and the browser parses it the same way, it just arrives all at once instead of token by token.

To stream for real, switch the Function URL to `RESPONSE_STREAM` invoke mode and wrap the handler in
`awslambda.streamifyResponse`:

```bash
aws lambda update-function-url-config \
  --function-name memora-api --invoke-mode RESPONSE_STREAM --region us-east-1
```

The buffered path is the default because it needs no extra code and degrades cleanly; the dashboard
works either way.

Check it came up:

```bash
curl https://<your-function-url>/api/health
```

That endpoint runs a `SELECT 1` against CockroachDB, so a healthy response means Lambda can reach the
cluster — not just that the function booted.

## 2. The dashboard — S3 + CloudFront

Point the frontend at the deployed API and build:

```bash
echo "VITE_API_URL=https://<your-function-url>" > .env.local
npm run build
```

Create a bucket and upload:

```bash
aws s3 mb s3://memora-dashboard-<something-unique>
aws s3 sync dist/ s3://memora-dashboard-<something-unique> --delete
```

Then create a CloudFront distribution with that bucket as the origin, using Origin Access Control so
the bucket itself stays private. Set the default root object to `index.html`, and add a custom error
response mapping 403 and 404 to `/index.html` with a 200 status — the dashboard is a single-page app,
so a deep link like `/dashboard` has to fall through to the app rather than 404 at the bucket.

## 3. Close the CORS loop

The API only accepts browser requests from origins it has been told about. Once CloudFront gives you
a domain, add it and redeploy:

```bash
# in server/.env
CORS_ALLOWED_ORIGINS=https://<your-cloudfront-domain>

cd server && ./deploy.sh
```

Leaving `http://localhost:5173` in the list alongside it is fine and keeps local development working.

## Before you submit

The hackathon requires a working demo judges can use free of charge, without restriction, until
judging ends on September 15, 2026. Concretely:

- [ ] The CloudFront URL loads and the dashboard reaches the API (the header reads "Connected", not
      "API unreachable")
- [ ] A fresh conversation can save a memory and recall it in a later message
- [ ] The CockroachDB cluster stays running — a paused free-tier cluster makes the demo look broken
- [ ] If anything is behind a login, the credentials are in the submission's testing instructions
- [ ] `MEMORA_API_KEYS` is either unset (open demo) or the demo key is in the testing instructions
