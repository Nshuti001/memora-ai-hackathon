import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { config } from './config.js';
import { query } from './db.js';
import {
  NEAR_DUPLICATE_DISTANCE,
  recall,
  recallLexical,
  remember,
  supersede,
  type MemoryKind,
  type RecalledMemory,
} from './memory.js';
import { recallAsOf } from './time-travel.js';
import { record } from './observability.js';
import {
  correctionStrength,
  inferImportance,
  inferKind,
  looksLikeGreeting,
  looksLikeQuestion,
} from './heuristics.js';

// Classic Bedrock Runtime client.
//
// Locally we pass keys explicitly, so a missing ambient credential chain (common when the process
// is started outside server/) fails loudly instead of silently degrading the agent. On Lambda that
// reasoning inverts: the execution role is the credential source, and Lambda reserves
// AWS_ACCESS_KEY_ID so the environment cannot carry one. There, absent keys are correct, and the
// SDK's default chain is what we want.
let bedrock: AnthropicBedrock | null = null;
function client(): AnthropicBedrock {
  if (!bedrock) {
    const accessKey = config.awsAccessKeyId;
    const secretKey = config.awsSecretAccessKey;

    // One retry, not the SDK default. A throttled response here means an exhausted quota, and
    // retrying that with exponential backoff turned a failed turn into a ~134s wait before the
    // memory-only fallback even started.
    const shared = { awsRegion: config.awsRegion, maxRetries: 1 };

    if (accessKey && secretKey) {
      bedrock = new AnthropicBedrock({
        ...shared,
        awsAccessKey: accessKey,
        awsSecretKey: secretKey,
      });
    } else if (config.onLambda) {
      bedrock = new AnthropicBedrock(shared);
    } else {
      throw new Error(
        'No AWS credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in server/.env — see SETUP.md step 2.',
      );
    }
  }
  return bedrock;
}

/**
 * How close an incoming correction must be to an existing memory before it supersedes it.
 *
 * Calibrated per embedding provider in config.ts. Anything nearer than NEAR_DUPLICATE_DISTANCE is a
 * restatement and is merged by remember() instead, so the supersession band is the gap between the
 * two. A weak marker ("now", "moved to") is held to the tighter `cluster` line, because on its own
 * it is as likely to be adding a fact as retracting one.
 */
const SUPERSEDE_DISTANCE = config.thresholds.supersede;

const SYSTEM_PROMPT = `You are Memora, a research assistant with persistent memory that survives across
sessions. Your memory lives in a CockroachDB cluster and is the reason you are useful: without it you are
just another chat window.

How to use it:

- Call recall_memory before answering anything that depends on prior context — the user's preferences, past
  decisions, earlier conversations, or anything they say you "already know". Do not guess at continuity you
  have not looked up.
- Call save_memory when the user tells you something durable: a preference, a decision, a constraint, a fact
  about their work. Do not save small talk, or anything you would not want repeated back in three months.
  Set kind to "semantic" for durable facts, "episodic" for things that happened, "procedural" for how-to
  knowledge.
- Call correct_memory when new information contradicts something you recalled. Superseding keeps the history
  auditable; silently saving a conflicting fact leaves you believing both.
- Call recall_as_of when the user asks what you knew or believed at some point in the past, or how your
  understanding has changed. This reads the database as it existed then, so it is the truth about your past
  state rather than a reconstruction.
- Call share_memory for facts that are about the team or the system rather than about this one user, so other
  agents in the workspace can recall them too.

When you use a recalled memory in an answer, say so in passing so the user can see where continuity came
from. Keep responses conversational and brief — a few sentences unless the question genuinely needs more.`;

const TOOLS = [
  {
    name: 'recall_memory',
    description:
      'Search long-term memory by meaning and return the most relevant memories. Call this before ' +
      'answering any question that depends on what you already know about this user or their work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to search for, phrased as the meaning you want rather than keywords.',
        },
        limit: { type: 'integer', description: 'How many memories to return. Default 6.' },
        kind: {
          type: 'string',
          enum: ['episodic', 'semantic', 'procedural'],
          description: 'Optional filter. Omit to search all memory types.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_memory',
    description:
      'Store a durable fact in long-term memory so it is available in future sessions. Near-identical ' +
      'memories are merged automatically, so restating a known fact is safe.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description:
            'The fact to remember, written as a standalone sentence that will make sense months ' +
            'from now without the surrounding conversation.',
        },
        kind: {
          type: 'string',
          enum: ['episodic', 'semantic', 'procedural'],
          description:
            'episodic = something that happened, semantic = a durable fact, procedural = how to do something.',
        },
        importance: {
          type: 'number',
          description: '0 to 1. Above 0.7 for things that shape future work; around 0.3 for incidental detail.',
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['content'],
    },
  },
  {
    name: 'correct_memory',
    description:
      'Replace a memory that is now wrong. The old memory is kept but marked superseded, so the change ' +
      'is auditable. Use the id from a recall_memory result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'id of the memory being replaced' },
        content: { type: 'string', description: 'The corrected fact.' },
      },
      required: ['memory_id', 'content'],
    },
  },
  {
    name: 'recall_as_of',
    description:
      'Search memory as it existed at a past moment, to answer what you knew or believed then. Use ' +
      'when the user asks about your past understanding or how it has changed since.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What to search for.' },
        at: {
          type: 'string',
          description:
            'A past point in time: a relative interval like "-2h", "-3d", or an ISO 8601 timestamp ' +
            'such as "2026-08-05T14:00:00Z".',
        },
        limit: { type: 'integer' },
      },
      required: ['query', 'at'],
    },
  },
  {
    name: 'share_memory',
    description:
      'Mark a memory as shared, making it recallable by every agent in this workspace. Use for facts ' +
      'about the team, the codebase, or the system rather than about one person.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'id of the memory to share' },
      },
      required: ['memory_id'],
    },
  },
];

export interface AgentTurn {
  reply: string;
  /** Memories the agent actually looked up this turn — the dashboard renders these as citations. */
  recalled: RecalledMemory[];
  saved: { id: string; content: string; deduplicated: boolean }[];
  toolCalls: { name: string; input: unknown }[];
  latencyMs: number;
  stopReason: string | null;
  /** Set when the turn ran without Claude. The UI labels these so nobody mistakes them for reasoning. */
  degraded?: { reason: string; detail: string };
}

/**
 * Distinguishes "Bedrock is not reachable for this deployment" from "Bedrock returned an error".
 *
 * The first is a configuration problem with an actionable fix and is worth degrading gracefully for;
 * the second is a genuine failure the operator needs to see, so it must not be swallowed.
 */
function bedrockUnavailableReason(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);

  if (/No AWS credentials/i.test(message)) {
    // client()'s own message for local dev with no keys configured — already actionable verbatim.
    return message;
  }
  if (/credential/i.test(message) && /resolve|provider chain|not found/i.test(message)) {
    return 'No AWS credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in server/.env — see SETUP.md step 2.';
  }
  if (/security token.*invalid|InvalidSignatureException|UnrecognizedClientException/i.test(message)) {
    return 'AWS credentials were rejected. Check the key pair in server/.env is current and not disabled.';
  }
  if (/AccessDenied|not authorized|don't have access to the model/i.test(message)) {
    return `Bedrock refused the model. The IAM user needs bedrock:InvokeModel, and Anthropic models may ask first-time users for use-case details.`;
  }
  if (/Too many tokens|ThrottlingException|rate exceeded|429/i.test(message)) {
    return 'Bedrock daily token quota is exhausted (common on new free-tier accounts). Wait for the quota to reset, or request a higher limit in Service Quotas. Memory still works without Claude.';
  }
  if (/on-demand throughput isn't supported|inference profile/i.test(message)) {
    return 'Use an inference profile ID for Claude (e.g. global.anthropic.claude-sonnet-4-6), not the bare anthropic.* model ID. Set BEDROCK_MODEL_ID in server/.env.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(message)) {
    return 'Could not reach Bedrock. Check network access and that AWS_REGION is a real region (us-east-1), not the string "global".';
  }
  return null;
}

/**
 * Circuit breaker around Bedrock.
 *
 * When the quota is exhausted every turn fails the same way, and paying the full request timeout
 * to rediscover that on each message makes the product feel broken rather than degraded. Once a
 * turn has established Bedrock is unavailable, later turns skip it and answer from memory
 * immediately, until the cooldown expires and one turn pays to re-check.
 *
 * The state is per process, so a fresh Lambda execution environment always probes once. That is
 * the behaviour we want: it costs one slow turn to notice the quota came back.
 */
const BEDROCK_RECHECK_MS = 60_000;
let bedrockDownUntil = 0;
let bedrockDownReason = '';

function bedrockKnownDown(): string | null {
  return Date.now() < bedrockDownUntil ? bedrockDownReason : null;
}

function markBedrockDown(reason: string): void {
  bedrockDownUntil = Date.now() + BEDROCK_RECHECK_MS;
  bedrockDownReason = reason;
}

function markBedrockUp(): void {
  bedrockDownUntil = 0;
  bedrockDownReason = '';
}

/**
 * A turn that exercises the memory layer without Claude.
 *
 * This exists so the product degrades into something honest rather than an error page: recall,
 * classification, deduplication and supersession are the parts being judged, and none of them need
 * an LLM. It performs no reasoning and says so — the reply reports what the memory layer did, and
 * never imitates an answer the model would have given.
 *
 * The classification and correction decisions come from `heuristics.ts` rather than from Claude.
 * That matters: storing everything as `semantic` and never superseding would keep the demo alive
 * while quietly removing memory types and supersession, which are the two behaviours that make
 * this a memory rather than a log — and supersession is what gives time travel anything to show.
 */
async function memoryOnlyTurn(
  opts: { tenantId: string; agentId: string; sessionId?: string | null; message: string },
  collected: Collected,
): Promise<string> {
  const message = opts.message.trim();

  // Semantic recall needs an embedding. If that fails, fall back to a lexical SQL match so the
  // store stays readable — degraded, but never dark.
  let hits: RecalledMemory[] = [];
  let lexical: Awaited<ReturnType<typeof recallLexical>> = [];
  let searchMode: 'meaning' | 'terms' = 'meaning';

  try {
    hits = await recall({
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      query: message,
      limit: 5,
      includeShared: true,
    });
    collected.recalled.push(...hits);
  } catch {
    searchMode = 'terms';
    lexical = await recallLexical({
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      query: message,
      limit: 5,
      includeShared: true,
    });
  }

  const found: { content: string; kind: string; score?: number }[] =
    searchMode === 'meaning' ? hits : lexical.map((m) => ({ content: m.content, kind: m.kind }));

  if (looksLikeGreeting(message)) {
    return (
      "I'm running on the CockroachDB memory layer alone right now — this deployment's Bedrock " +
      'quota is exhausted, so there is no model reasoning behind these replies. Everything else is ' +
      'real: tell me a fact about how you work and I will classify it, embed it and store it. Ask ' +
      'about it later and I will recall it by meaning. Correct it and I will supersede the old one, ' +
      'which you can then watch change in Time Travel.'
    );
  }

  if (looksLikeQuestion(message)) {
    if (found.length === 0) {
      return (
        "I don't have anything in memory that matches that yet. Tell me the answer as a clear fact " +
        'and I will store it for next time.'
      );
    }
    const top = found[0];
    const others = found.slice(1, 4);
    const lines = [
      top.content,
      '',
      `(recalled from CockroachDB by ${
        searchMode === 'meaning' ? 'meaning' : 'matching terms'
      }${top.score != null ? `, score ${top.score.toFixed(2)}` : ''})`,
    ];
    if (others.length) {
      lines.push('', 'Also related:');
      for (const m of others) lines.push(`\u2022 ${m.content}`);
    }
    return lines.join('\n');
  }

  // Short interjections ("ok", "thanks") are not facts — storing them pollutes the store.
  if (message.split(/\s+/).length < 4) {
    return found.length
      ? `Nothing to store in that. Closest memory I already hold: "${found[0].content}"`
      : 'Nothing to store in that. Tell me a fact about how you work and I will remember it.';
  }

  // Writing requires an embedding — there is no way to store a memory the vector index can find
  // without one. Refuse clearly rather than writing a row that recall could never retrieve.
  if (searchMode === 'terms') {
    return (
      'I can read memory but not write it right now: storing a memory requires an embedding, and ' +
      'the embedding service is unavailable. Restore AWS credentials (or set EMBEDDING_PROVIDER=local ' +
      'in server/.env) and I will store this.'
    );
  }

  const kind = inferKind(message);
  const importance = inferImportance(message, kind);

  // Does this replace something already known? A strong marker ("actually", "no longer") is trusted
  // on its own; a weak one ("now", "moved to") only counts when the nearest memory is close enough
  // in embedding space to plausibly be the thing being corrected. Without that guard, "we now have
  // three regions" would retract an unrelated fact instead of adding one.
  const strength = correctionStrength(message);
  const nearest = hits[0];
  const ceiling = strength === 'strong' ? SUPERSEDE_DISTANCE : config.thresholds.cluster;
  const nearEnough =
    nearest != null &&
    nearest.distance != null &&
    nearest.distance <= ceiling &&
    nearest.distance > NEAR_DUPLICATE_DISTANCE;

  if (nearest && nearEnough && strength !== 'none') {
    const replacement = await supersede({
      tenantId: opts.tenantId,
      agentId: opts.agentId,
      oldId: nearest.id,
      content: message,
      kind,
      importance: Math.max(importance, 0.7),
    });
    collected.saved.push({ id: replacement.id, content: replacement.content, deduplicated: false });

    return (
      `Updated. I was holding "${nearest.content}" \u2014 that is now marked superseded rather than ` +
      `deleted, with a supersedes edge to the new ${kind} memory ` +
      `(${replacement.id.slice(0, 8)}).\n\nAsk Time Travel what I believed before this and the old ` +
      'answer is still there.'
    );
  }

  const { memory, deduplicated } = await remember({
    tenantId: opts.tenantId,
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    content: message,
    kind,
    importance,
  });
  collected.saved.push({ id: memory.id, content: memory.content, deduplicated });

  return deduplicated
    ? 'Already knew that \u2014 reinforced the existing memory instead of duplicating it.'
    : `Got it \u2014 stored in CockroachDB as a ${kind} memory (${memory.id.slice(0, 8)}), ` +
      `importance ${importance}. Ask me about it later and I will recall it by meaning.`;
}

type Content = { type: string; [key: string]: unknown };

interface TurnContext {
  tenantId: string;
  agentId: string;
  sessionId?: string | null;
}

interface Collected {
  recalled: RecalledMemory[];
  saved: AgentTurn['saved'];
}

/** Events emitted by the streaming variant, consumed by the SSE endpoint. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; summary: string; memories?: RecalledMemory[] }
  | { type: 'done'; turn: AgentTurn }
  | { type: 'error'; message: string };

/**
 * Runs one conversational turn, letting the model drive its own memory reads and writes.
 *
 * The loop is manual rather than using the SDK tool runner so that every recall and save is captured
 * for the dashboard — showing which memories were consulted is the whole point of the product.
 */
export async function runTurn(opts: {
  tenantId: string;
  agentId: string;
  sessionId?: string | null;
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  maxIterations?: number;
}): Promise<AgentTurn> {
  const events: AgentEvent[] = [];
  for await (const event of streamTurn(opts)) events.push(event);

  const done = events.find((e) => e.type === 'done');
  if (done && done.type === 'done') return done.turn;

  const failure = events.find((e) => e.type === 'error');
  throw new Error(failure && failure.type === 'error' ? failure.message : 'Agent turn produced no result');
}

/**
 * Streaming turn. Yields text as the model produces it and announces each tool call, so the UI can
 * show the agent reaching into memory rather than freezing until the whole turn completes.
 */
export async function* streamTurn(opts: {
  tenantId: string;
  agentId: string;
  sessionId?: string | null;
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  maxIterations?: number;
}): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const maxIterations = opts.maxIterations ?? 6;

  const messages: { role: 'user' | 'assistant'; content: string | Content[] }[] = [
    ...(opts.history ?? []),
    { role: 'user', content: opts.message },
  ];

  const collected: Collected = { recalled: [], saved: [] };
  const toolCalls: AgentTurn['toolCalls'] = [];
  let finalText = '';
  let stopReason: string | null = null;
  let degraded: AgentTurn['degraded'];

  // Skip Bedrock entirely while the breaker is open — a recent turn already established it is
  // unavailable, and re-establishing that costs the whole request timeout on every message.
  const knownDown = bedrockKnownDown();
  if (knownDown) {
    degraded = { reason: 'bedrock_unavailable', detail: knownDown };
    const reply = await memoryOnlyTurn(opts, collected);
    record('agent.turn.degraded', Date.now() - started, false);
    yield { type: 'text', text: reply };
    yield {
      type: 'done',
      turn: {
        reply,
        recalled: collected.recalled,
        saved: collected.saved,
        toolCalls,
        latencyMs: Date.now() - started,
        stopReason: 'memory_only',
        degraded,
      },
    };
    return;
  }

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Keep max_tokens modest — free-tier accounts share a daily token budget, and adaptive
      // thinking was burning it without improving tool use for this product.
      const stream = client().messages.stream({
        model: config.modelId,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: messages as never,
      });

      let iterationText = '';
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          iterationText += event.delta.text;
          yield { type: 'text', text: event.delta.text };
        }
      }

      const response = await stream.finalMessage();
      stopReason = response.stop_reason ?? null;

      if (response.stop_reason !== 'tool_use') {
        finalText = iterationText.trim();
        break;
      }

      messages.push({ role: 'assistant', content: response.content as unknown as Content[] });

      const results: Content[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const input = block.input as Record<string, unknown>;
        toolCalls.push({ name: block.name, input });
        yield { type: 'tool_start', name: block.name, input };

        const toolStarted = Date.now();
        try {
          const summary = await executeTool(block.name, input, opts, collected);
          record(`tool.${block.name}`, Date.now() - toolStarted, false);

          results.push({ type: 'tool_result', tool_use_id: block.id, content: summary });
          yield {
            type: 'tool_result',
            name: block.name,
            summary,
            memories: block.name.startsWith('recall') ? collected.recalled : undefined,
          };
        } catch (err) {
          record(`tool.${block.name}`, Date.now() - toolStarted, true);
          const message = err instanceof Error ? err.message : String(err);

          // Report the failure to the model as a tool result rather than aborting the turn — it can
          // usually recover by trying a different query, and dropping the result would leave the
          // conversation with an unanswered tool_use block, which the API rejects.
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Tool failed: ${message}`,
            is_error: true,
          });
          yield { type: 'tool_result', name: block.name, summary: `failed: ${message}` };
        }
      }

      // All tool results go back in a single user message — splitting them across messages teaches
      // the model to stop making parallel calls.
      messages.push({ role: 'user', content: results });
    }

    if (!finalText) {
      finalText =
        'I used up my tool budget for this turn without reaching an answer. Try narrowing the question.';
    }

    const turn: AgentTurn = {
      reply: finalText,
      recalled: collected.recalled,
      saved: collected.saved,
      toolCalls,
      latencyMs: Date.now() - started,
      stopReason,
      degraded,
    };

    markBedrockUp();
    record('agent.turn', turn.latencyMs, false);
    yield { type: 'done', turn };
  } catch (err) {
    const reason = bedrockUnavailableReason(err);

    // Only a configuration-shaped Bedrock failure degrades. Anything else is a real bug and is
    // reported as an error, because silently answering around it would hide the problem.
    if (!reason) {
      record('agent.turn', Date.now() - started, true);
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    record('agent.turn.degraded', Date.now() - started, false);
    degraded = { reason: 'bedrock_unavailable', detail: reason };
    markBedrockDown(reason);
    console.warn(`[agent] Bedrock unavailable, serving memory-only turn — ${reason}`);

    try {
      const reply = await memoryOnlyTurn(opts, collected);
      yield { type: 'text', text: reply };
      yield {
        type: 'done',
        turn: {
          reply,
          recalled: collected.recalled,
          saved: collected.saved,
          toolCalls,
          latencyMs: Date.now() - started,
          stopReason: 'memory_only',
          degraded,
        },
      };
    } catch (fallbackErr) {
      // The memory layer itself is broken, which is a genuine outage — surface it.
      record('agent.turn', Date.now() - started, true);
      yield {
        type: 'error',
        message: `${reason} The memory layer also failed: ${
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        }`,
      };
    }
  }
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: TurnContext,
  collected: Collected,
): Promise<string> {
  switch (name) {
    case 'recall_memory': {
      const hits = await recall({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        query: String(input.query),
        limit: typeof input.limit === 'number' ? input.limit : 6,
        kinds: input.kind ? [input.kind as MemoryKind] : undefined,
        includeShared: true,
      });
      collected.recalled.push(...hits);

      if (hits.length === 0) return 'No memories matched. This appears to be new information.';

      return JSON.stringify(
        hits.map((m) => ({
          id: m.id,
          content: m.content,
          kind: m.kind,
          relevance: Number(m.score.toFixed(3)),
          remembered: m.created_at,
        })),
      );
    }

    case 'recall_as_of': {
      const hits = await recallAsOf({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        query: String(input.query),
        at: String(input.at),
        limit: typeof input.limit === 'number' ? input.limit : 6,
      });

      if (hits.length === 0) {
        return `Nothing matching that was in memory as of ${String(input.at)}.`;
      }

      return JSON.stringify(
        hits.map((m) => ({ id: m.id, content: m.content, kind: m.kind, remembered: m.created_at })),
      );
    }

    case 'save_memory': {
      const { memory, deduplicated } = await remember({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        content: String(input.content),
        kind: (input.kind as MemoryKind) ?? 'semantic',
        importance: typeof input.importance === 'number' ? input.importance : 0.5,
        tags: Array.isArray(input.tags) ? (input.tags as string[]) : [],
      });
      collected.saved.push({ id: memory.id, content: memory.content, deduplicated });

      return deduplicated
        ? `Already knew this — reinforced existing memory ${memory.id} instead of duplicating it.`
        : `Saved as memory ${memory.id}.`;
    }

    case 'correct_memory': {
      const memory = await supersede({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        oldId: String(input.memory_id),
        content: String(input.content),
      });
      collected.saved.push({ id: memory.id, content: memory.content, deduplicated: false });

      return `Corrected. New memory ${memory.id} now supersedes ${String(input.memory_id)}.`;
    }

    case 'share_memory': {
      // Scoped by tenant AND agent so a compromised or confused agent cannot flip the sharing flag
      // on a memory belonging to a different agent.
      const rows = await query<{ id: string }>(
        `UPDATE memories SET shared = true, updated_at = now()
          WHERE tenant_id = $1 AND agent_id = $2 AND id = $3
          RETURNING id`,
        [ctx.tenantId, ctx.agentId, String(input.memory_id)],
      );

      return rows.length
        ? `Memory ${rows[0].id} is now shared with every agent in this workspace.`
        : 'No such memory belongs to this agent, so nothing was shared.';
    }

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
