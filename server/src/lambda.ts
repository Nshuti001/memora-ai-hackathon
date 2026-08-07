/**
 * AWS Lambda entry point (Function URL / API Gateway HTTP API, payload format 2.0).
 *
 * The pg pool is module-scoped, so it is created once per Lambda execution environment and reused
 * across invocations rather than reconnecting on every request — reconnecting to CockroachDB per
 * invocation would dominate the response time and exhaust the cluster's connection limit under any
 * real concurrency.
 */
import { config } from './config.js';
import { handleRequest } from './api.js';
import type { AgentEvent } from './agent.js';

interface LambdaEvent {
  requestContext: { http: { method: string; path: string } };
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export async function handler(event: LambdaEvent) {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const origin = event.headers?.origin;
  const allowed = origin && config.corsAllowedOrigins.includes(origin);

  const corsHeaders: Record<string, string> = {
    'access-control-allow-headers': 'content-type, x-api-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    ...(allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  };

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  let body: Record<string, unknown> | null = null;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Body is not valid JSON' }),
      };
    }
  }

  const response = await handleRequest({
    method,
    path,
    searchParams: new URLSearchParams(event.rawQueryString ?? ''),
    body,
    headers: event.headers ?? {},
  });

  if (response.kind === 'stream') {
    // A buffered Lambda invocation cannot flush incrementally, so the SSE frames are collected and
    // returned in one body. The wire format is identical, so the browser parses it the same way —
    // it simply arrives all at once instead of token by token. To stream for real, deploy with
    // RESPONSE_STREAM invoke mode and awslambda.streamifyResponse; see DEPLOY.md.
    const frames: string[] = [];
    for await (const chunk of response.events as AsyncGenerator<AgentEvent>) {
      frames.push(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    return {
      statusCode: response.status,
      headers: { ...corsHeaders, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: frames.join(''),
    };
  }

  return {
    statusCode: response.status,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...response.headers },
    body: JSON.stringify(response.body),
  };
}
