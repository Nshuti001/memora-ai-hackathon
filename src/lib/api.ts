/**
 * Client for the Memora memory API.
 *
 * Base URL comes from VITE_API_URL so the same build points at localhost in development and at the
 * Lambda Function URL in production. The browser never talks to CockroachDB directly — it has no
 * credentials, and the connection string stays server-side.
 */
// Every request carries the signed-in session, so the server scopes reads and writes to that
// user's own tenant. Signed out, the calls fall through to the shared demo tenant.
import { authHeader } from './auth';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:8787';
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export type MemoryKind = 'episodic' | 'semantic' | 'procedural';
export type GraphNodeStatus = 'live' | 'superseded' | 'archived';

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  confidence: number;
  tags: string[];
  access_count: number;
  created_at: string;
  shared?: boolean;
}

export interface RecalledMemory extends Memory {
  distance: number;
  score: number;
}

export interface GraphNode extends Memory {
  status: GraphNodeStatus;
}

export interface GraphEdge {
  src_id: string;
  dst_id: string;
  relation: string;
  weight: number;
}

export interface Stats {
  total: number;
  episodic: number;
  semantic: number;
  procedural: number;
  superseded: number;
  archived: number;
  shared: number;
  consolidated: number;
  avgRecallMs: number | null;
  avgImportance: number | null;
  /** Whether the store and the active embedding model agree. */
  embeddings?: {
    activeModel: string;
    byModel: { model: string; count: number }[];
    /** Live memories the active model cannot search, because they sit in another vector space. */
    unsearchable: number;
  };
}

export interface AuditEntry {
  id: string;
  operation: string;
  query: string | null;
  result_ids: string[];
  latency_ms: number | null;
  created_at: string;
}

export interface ChatTurn {
  reply: string;
  recalled: RecalledMemory[];
  saved: { id: string; content: string; deduplicated: boolean }[];
  toolCalls: { name: string; input: unknown }[];
  latencyMs: number;
  stopReason: string | null;
  /** Present when the turn ran without Claude — the memory layer answered on its own. */
  degraded?: { reason: string; detail: string };
}

export interface BeliefDiff {
  at: string;
  then: Memory[];
  now: Memory[];
  learned: Memory[];
  changed: Memory[];
  unchanged: Memory[];
}

export interface ProvenanceStep {
  id: string;
  content: string;
  kind: MemoryKind;
  confidence: number;
  created_at: string;
  relation: string | null;
}

export interface OperationMetrics {
  count: number;
  errors: number;
  errorRate: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

/** Streaming events emitted by /api/chat/stream. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; summary: string; memories?: RecalledMemory[] }
  | { type: 'done'; turn: ChatTurn }
  | { type: 'error'; message: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...authHeader(),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () =>
    request<{ ok: boolean; model: string; region: string; embeddingProvider: string; databaseLatencyMs: number }>(
      '/api/health',
    ),

  chat: (message: string, history: { role: 'user' | 'assistant'; content: string }[]) =>
    request<ChatTurn>('/api/chat', { method: 'POST', body: JSON.stringify({ message, history }) }),

  memories: (limit = 50) => request<{ memories: Memory[] }>(`/api/memories?limit=${limit}`),

  addMemory: (content: string, kind: MemoryKind = 'semantic') =>
    request<{ memory: Memory; deduplicated: boolean }>('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ content, kind }),
    }),

  search: (q: string, limit = 8) =>
    request<{ results: RecalledMemory[]; latencyMs: number }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  timeTravel: (q: string, at: string, limit = 8) =>
    request<{ at: string; results: Memory[]; latencyMs: number }>(
      `/api/time-travel?q=${encodeURIComponent(q)}&at=${encodeURIComponent(at)}&limit=${limit}`,
    ),

  beliefDiff: (q: string, at: string) =>
    request<BeliefDiff>(`/api/belief-diff?q=${encodeURIComponent(q)}&at=${encodeURIComponent(at)}`),

  provenance: (memoryId: string) =>
    request<{ chain: ProvenanceStep[] }>(`/api/provenance?memoryId=${encodeURIComponent(memoryId)}`),

  retention: () => request<{ seconds: number; humanized: string }>('/api/retention'),

  consolidate: () =>
    request<{
      clustersFound: number;
      memoriesCreated: { id: string; content: string; sourceCount: number }[];
      sourcesConsolidated: number;
    }>('/api/consolidate', { method: 'POST', body: '{}' }),

  decay: (intensity = 1) =>
    request<{ decayed: number; archived: number }>('/api/decay', {
      method: 'POST',
      body: JSON.stringify({ intensity }),
    }),

  stats: () => request<Stats>('/api/stats'),

  audit: (limit = 12) => request<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`),

  graph: (limit = 40) => request<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/graph?limit=${limit}`),

  metrics: () =>
    request<{ uptimeSeconds: number; operations: Record<string, OperationMetrics> }>('/api/metrics'),
};

/**
 * Streams an agent turn, invoking `onEvent` as each frame arrives.
 *
 * The response is server-sent events. In Lambda's buffered invoke mode the whole body arrives at
 * once — the parsing below handles both cases identically, because it splits on frame boundaries
 * rather than assuming one frame per chunk.
 */
export async function streamChat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...authHeader(),
    },
    body: JSON.stringify({ message, history }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error ?? `Stream failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // A chunk can end mid-frame, so only complete frames (terminated by a blank line) are consumed;
    // the remainder stays buffered for the next read.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        // A malformed frame should not kill the stream — skip it and keep reading.
      }
    }
  }
}

/** "2 min ago" style formatting for memory timestamps. */
export function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}
