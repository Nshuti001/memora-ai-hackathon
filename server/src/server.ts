/**
 * Local development server. The same routing runs unchanged in Lambda — see lambda.ts.
 */
import { createServer, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { handleRequest, type ApiResponse } from './api.js';

const MAX_BODY_BYTES = 1_000_000;

function applyCors(res: ServerResponse, origin: string | undefined): void {
  if (origin && config.corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function writeStream(res: ServerResponse, response: Extract<ApiResponse, { kind: 'stream' }>) {
  res.writeHead(response.status, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Proxies that buffer responses defeat the point of streaming; this asks nginx not to.
    'x-accel-buffering': 'no',
  });

  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
  });

  try {
    for await (const event of response.events) {
      // Stop doing work the moment nobody is listening — otherwise an abandoned chat keeps burning
      // Bedrock tokens until the agent loop finishes on its own.
      if (clientGone) break;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!clientGone) res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
  } finally {
    if (!clientGone) res.end();
  }
}

const server = createServer(async (req, res) => {
  applyCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  let body: Record<string, unknown> | null = null;
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Body is not valid JSON' }));
        return;
      }
    }
  }

  const response = await handleRequest({
    method: req.method ?? 'GET',
    path: url.pathname,
    searchParams: url.searchParams,
    body,
    headers: req.headers as Record<string, string | undefined>,
  });

  if (response.kind === 'stream') {
    await writeStream(res, response);
    return;
  }

  res.writeHead(response.status, { 'content-type': 'application/json', ...response.headers });
  res.end(JSON.stringify(response.body));
});

server.listen(config.port, () => {
  console.log(`Memora API listening on http://localhost:${config.port}`);
  console.log(`  model      ${config.modelId}`);
  console.log(`  embeddings ${config.embeddingProvider}`);
  console.log(`  region     ${config.awsRegion}`);
  console.log(`  cors       ${config.corsAllowedOrigins.join(', ')}`);
});
