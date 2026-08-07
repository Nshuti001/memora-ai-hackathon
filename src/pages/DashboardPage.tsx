import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Search, Bot, User, Clock, Activity, Brain, TrendingUp, Tag, Zap,
  ArrowRight, CircleDot, AlertTriangle, History, Layers, Sparkles, Share2, Archive,
} from 'lucide-react';
import KnowledgeGraph, { GraphLegend } from '../components/KnowledgeGraph';
import {
  api, relativeTime, streamChat,
  type AuditEntry, type BeliefDiff, type GraphEdge, type GraphNode,
  type Memory, type RecalledMemory, type Stats,
} from '../lib/api';
import { VIZ, viz } from '../lib/viz';

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  memories?: { id: string; content: string }[];
  tools?: string[];
  latencyMs?: number;
  streaming?: boolean;
  /** Answered by the memory layer alone, with no model reasoning behind it. */
  degraded?: boolean;
}

const GREETING: ChatMessage = {
  role: 'agent',
  content:
    "I'm Memora. Everything you tell me is stored in CockroachDB and recalled by meaning, so it " +
    "survives this session. Tell me something about how you work, then ask me about it later — or " +
    'ask what I believed an hour ago.',
};

type Tab = 'timeline' | 'graph' | 'history';

export default function DashboardPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchResults, setSearchResults] = useState<RecalledMemory[] | null>(null);
  const [searchLatency, setSearchLatency] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });

  const [travelQuery, setTravelQuery] = useState('');
  const [travelAt, setTravelAt] = useState('-1h');
  const [diff, setDiff] = useState<BeliefDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [retention, setRetention] = useState<string | null>(null);

  const [maintenance, setMaintenance] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [memoryPage, statsPayload, auditPage, graph, retentionInfo] = await Promise.all([
        api.memories(50),
        api.stats(),
        api.audit(6),
        api.graph(40),
        api.retention(),
      ]);
      setMemories(memoryPage.memories);
      setStats(statsPayload);
      setAudit(auditPage.entries);
      setGraphData(graph);
      setRetention(retentionInfo.humanized);
      setConnectionError(null);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Cannot reach the memory API');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // `block: 'nearest'` confines the scroll to the chat pane. The default ('start') scrolls the
    // whole document, which on first render jumps the page past its own header.
    if (messages.length <= 1) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isTyping]);

  // Abort any in-flight stream when the page unmounts, so an abandoned conversation stops burning
  // Bedrock tokens the moment nobody is watching.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchLatency(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { results, latencyMs } = await api.search(q);
        setSearchResults(results);
        setSearchLatency(latencyMs);
      } catch {
        setSearchResults([]);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isTyping) return;

    const history = messages
      .filter((m) => m !== GREETING)
      .map((m) => ({
        role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setIsTyping(true);

    // The streaming placeholder is appended once, then mutated in place as frames arrive.
    setMessages((m) => [...m, { role: 'agent', content: '', streaming: true, tools: [] }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const patchLast = (patch: (msg: ChatMessage) => ChatMessage) =>
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last?.role === 'agent') next[next.length - 1] = patch(last);
        return next;
      });

    try {
      await streamChat(
        text,
        history,
        (event) => {
          if (event.type === 'text') {
            patchLast((msg) => ({ ...msg, content: msg.content + event.text }));
          } else if (event.type === 'tool_start') {
            patchLast((msg) => ({ ...msg, tools: [...(msg.tools ?? []), event.name] }));
          } else if (event.type === 'done') {
            setDegraded(event.turn.degraded?.detail ?? null);
            patchLast((msg) => ({
              ...msg,
              content: event.turn.reply || msg.content,
              memories: event.turn.recalled.map((r) => ({ id: r.id, content: r.content })),
              latencyMs: event.turn.latencyMs,
              streaming: false,
              degraded: Boolean(event.turn.degraded),
            }));
          } else if (event.type === 'error') {
            patchLast((msg) => ({
              ...msg,
              content: `The agent failed: ${event.message}`,
              streaming: false,
            }));
          }
        },
        controller.signal,
      );
      void refresh();
    } catch (err) {
      patchLast((msg) => ({
        ...msg,
        content: `The memory API is unreachable: ${err instanceof Error ? err.message : 'unknown error'}. Check that the server is running and server/.env is filled in.`,
        streaming: false,
      }));
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  }

  async function runBeliefDiff() {
    const q = travelQuery.trim();
    if (!q) return;

    setDiffLoading(true);
    try {
      setDiff(await api.beliefDiff(q, travelAt));
      setConnectionError(null);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Time-travel query failed');
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }

  async function runConsolidation() {
    setMaintenance('Consolidating…');
    try {
      const result = await api.consolidate();
      setMaintenance(
        result.memoriesCreated.length === 0
          ? 'No clusters large enough to consolidate yet.'
          : `Distilled ${result.sourcesConsolidated} episodes into ${result.memoriesCreated.length} durable fact(s).`,
      );
      void refresh();
    } catch (err) {
      setMaintenance(err instanceof Error ? err.message : 'Consolidation failed');
    }
  }

  async function runDecay() {
    setMaintenance('Applying decay…');
    try {
      const result = await api.decay(1);
      setMaintenance(`Decayed ${result.decayed} memories, archived ${result.archived}.`);
      void refresh();
    } catch (err) {
      setMaintenance(err instanceof Error ? err.message : 'Decay failed');
    }
  }

  const displayed: (Memory & { score?: number })[] = searchResults ?? memories;

  const statCards = [
    { label: 'Live Memories', value: stats ? String(stats.total) : '—', icon: Brain, accent: 'brand' },
    { label: 'Durable Facts', value: stats ? String(stats.semantic) : '—', icon: TrendingUp, accent: 'emerald' },
    { label: 'Superseded', value: stats ? String(stats.superseded) : '—', icon: ArrowRight, accent: 'brand' },
    { label: 'Archived', value: stats ? String(stats.archived) : '—', icon: Archive, accent: 'brand' },
    {
      label: 'Avg Recall',
      value: stats?.avgRecallMs != null ? `${stats.avgRecallMs}ms` : '—',
      icon: Zap,
      accent: 'emerald',
    },
  ];

  return (
    <div className="pt-28 pb-12 min-h-screen">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-content">Agent Dashboard</h1>
            <p className="text-sm text-content-subtle mt-1">
              Live memory served from CockroachDB
              {retention && ` · ${retention} of history queryable`}
            </p>
          </div>
          <div className="glass rounded-xl px-3 py-2 flex items-center gap-2">
            {connectionError ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                <span className="text-xs font-medium text-warning">API unreachable</span>
              </>
            ) : (
              <>
                <CircleDot className="w-3.5 h-3.5 text-positive animate-pulse" />
                <span className="text-xs font-medium text-content-muted">Connected</span>
              </>
            )}
          </div>
        </div>

        {connectionError && (
          <div className="mb-6 glass rounded-2xl p-4 border border-warning/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div className="text-sm text-content-muted">
                <p className="text-warning font-medium">Not connected to the memory API</p>
                <p className="mt-1 leading-relaxed">
                  {connectionError}. Start it with <code className="font-mono text-accent">cd server &amp;&amp; npm run dev</code>,
                  and make sure <code className="font-mono text-accent">server/.env</code> has your CockroachDB and AWS
                  credentials. See SETUP.md.
                </p>
              </div>
            </div>
          </div>
        )}

        {stats?.embeddings != null && stats.embeddings.unsearchable > 0 && (
          <div className="mb-6 glass rounded-2xl p-4 border border-danger/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-sm text-content-muted">
                <p className="text-danger font-medium">
                  {stats.embeddings.unsearchable} memor
                  {stats.embeddings.unsearchable === 1 ? 'y is' : 'ies are'} not searchable
                </p>
                <p className="mt-1 leading-relaxed">
                  They were embedded by a different model than the active one
                  (<code className="font-mono text-accent">{stats.embeddings.activeModel}</code>), and
                  vectors from two models sit in unrelated spaces — comparing them returns noise, so
                  recall excludes them rather than ranking garbage. The rows are intact; re-embed with{' '}
                  <code className="font-mono text-accent">npm run db:reembed -- --run</code>.
                </p>
                <p className="mt-1 text-[11px] font-mono text-content-subtle">
                  {stats.embeddings.byModel.map((m) => `${m.count}× ${m.model}`).join('  ·  ')}
                </p>
              </div>
            </div>
          </div>
        )}

        {degraded && (
          <div className="mb-6 glass rounded-2xl p-4 border border-warning/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div className="text-sm text-content-muted">
                <p className="text-warning font-medium">
                  Memory-only mode — replies are not coming from Claude
                </p>
                <p className="mt-1 leading-relaxed">
                  {degraded} Recall, storage, search, the graph and time travel all still run against
                  CockroachDB; only the model reasoning is unavailable. Answers below are the memory
                  layer reporting what it stored and retrieved, nothing more.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {statCards.map((s, i) => (
            <div key={i} className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-content-subtle">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.accent === 'brand' ? 'text-accent' : 'text-positive'}`} />
              </div>
              <div className="font-display text-2xl font-bold text-content">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Chat */}
          <div className="lg:col-span-5 glass rounded-2xl flex flex-col h-[640px]">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-line/[0.10]">
              <div className="w-9 h-9 rounded-xl bg-accent/[0.12] border border-accent/25 flex items-center justify-center">
                <Bot className="w-5 h-5 text-accent" />
              </div>
              <div>
                <div className="text-sm font-semibold text-content">Memora Agent</div>
                <div className={`text-xs flex items-center gap-1 ${degraded ? 'text-warning' : 'text-positive'}`}>
                  <CircleDot className="w-2.5 h-2.5" />
                  {degraded
                    ? 'Memory-only · Bedrock unavailable'
                    : 'Claude on Bedrock · memory in CockroachDB'}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    msg.role === 'user' ? 'bg-line/[0.10]' : 'bg-accent/[0.12] border border-accent/25'
                  }`}>
                    {msg.role === 'user'
                      ? <User className="w-4 h-4 text-content-muted" />
                      : <Bot className="w-4 h-4 text-accent" />}
                  </div>
                  <div className={`max-w-[82%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                    {msg.tools && msg.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {msg.tools.map((tool, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center gap-1 rounded bg-positive/10 border border-positive/25 px-1.5 py-0.5 text-[9px] font-mono text-positive"
                          >
                            <Sparkles className="w-2 h-2" /> {tool}
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.degraded && (
                      <div className="mb-1 inline-flex items-center gap-1 rounded bg-warning/10 border border-warning/30 px-1.5 py-0.5 text-[9px] font-mono text-warning">
                        <AlertTriangle className="w-2 h-2" /> memory layer only — not model output
                      </div>
                    )}

                    {(msg.content || !msg.streaming) && (
                      <div className={`inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                        msg.role === 'user' ? 'bg-line/[0.10] text-content' : 'glass text-content'
                      }`}>
                        {msg.content}
                        {msg.streaming && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-accent animate-pulse align-middle" />}
                      </div>
                    )}

                    {msg.memories && msg.memories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 justify-start">
                        {msg.memories.map((mem) => (
                          <span
                            key={mem.id}
                            title={mem.content}
                            className="inline-flex items-center gap-1 rounded-md bg-accent/[0.10] border border-accent/25 px-2 py-0.5 text-[10px] font-mono text-accent"
                          >
                            <Brain className="w-2.5 h-2.5" /> recalled {mem.id.slice(0, 8)}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.latencyMs != null && (
                      <div className="mt-1 text-[10px] font-mono text-content-subtle">{msg.latencyMs}ms</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="px-5 py-4 border-t border-line/[0.10]">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder="Tell the agent something, or ask what it remembers…"
                  className="flex-1 bg-surface-sunken rounded-xl px-4 py-2.5 text-sm text-content placeholder:text-content-subtle border border-line/[0.10] focus:border-accent/40 focus:outline-none transition-colors"
                />
                <button
                  onClick={sendMessage}
                  disabled={isTyping || !input.trim()}
                  className="shrink-0 w-10 h-10 coarse:w-11 coarse:h-11 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 flex items-center justify-center hover:shadow-lg hover:shadow-brand-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="lg:col-span-7 space-y-4">
            <div className="glass rounded-2xl p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-subtle" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search memories by meaning…"
                    className="w-full bg-surface-sunken rounded-xl pl-10 pr-4 py-2.5 text-sm text-content placeholder:text-content-subtle border border-line/[0.10] focus:border-accent/40 focus:outline-none transition-colors"
                  />
                </div>
                <div className="flex glass rounded-xl p-1">
                  {([
                    ['timeline', 'Timeline', Layers],
                    ['graph', 'Graph', Share2],
                    ['history', 'Time Travel', History],
                  ] as const).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={`flex-1 sm:flex-none justify-center px-3 py-1.5 coarse:py-2.5 coarse:min-h-[44px] rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                        activeTab === id ? 'bg-accent/[0.15] text-accent' : 'text-content-subtle hover:text-content'
                      }`}
                    >
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'timeline' && (
                <>
                  {searchResults && (
                    <div className="mb-3 text-[11px] font-mono text-content-subtle">
                      {searchResults.length} match{searchResults.length === 1 ? '' : 'es'} by vector similarity
                      {searchLatency != null && ` · ${searchLatency}ms`}
                    </div>
                  )}
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {displayed.map((m) => (
                      <div key={m.id} className="glass rounded-xl p-3 hover:bg-line/[0.04] transition-all group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Clock className="w-3 h-3 text-content-subtle shrink-0" />
                              <span className="text-[10px] font-mono text-content-subtle">{relativeTime(m.created_at)}</span>
                              <span className="text-[10px] text-content-subtle">·</span>
                              <span className="text-[10px] text-content-subtle">{m.kind}</span>
                              {m.shared && (
                                <span className="text-[9px] px-1.5 rounded bg-warning/15 text-warning">shared</span>
                              )}
                              {m.score != null && (
                                <span className="text-[10px] font-mono text-accent">{m.score.toFixed(3)}</span>
                              )}
                            </div>
                            <p className="text-sm text-content group-hover:text-accent transition-colors">{m.content}</p>
                            {m.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {m.tags.map((t, j) => (
                                  <span key={j} className="inline-flex items-center gap-0.5 rounded bg-line/[0.04] px-1.5 py-0.5 text-[9px] font-mono text-content-subtle">
                                    <Tag className="w-2 h-2" /> {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 text-right space-y-1">
                            {[
                              { value: m.importance, className: 'bg-gradient-to-r from-brand-400 to-emerald-400' },
                              { value: m.confidence, className: 'bg-positive' },
                            ].map((bar, j) => (
                              <div key={j} className="flex items-center gap-1">
                                <div className="w-16 h-1.5 rounded-full bg-line/[0.10] overflow-hidden">
                                  <div className={`h-full rounded-full ${bar.className}`} style={{ width: `${Math.round(bar.value * 100)}%` }} />
                                </div>
                                <span className="text-[9px] font-mono text-content-subtle w-6">{Math.round(bar.value * 100)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                    {displayed.length === 0 && (
                      <div className="text-center py-8 text-sm text-content-subtle">
                        {searchQuery
                          ? `Nothing close to "${searchQuery}" yet`
                          : 'No memories yet — tell the agent something in the chat.'}
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'graph' && (
                <div>
                  <div className="h-[300px]">
                    <KnowledgeGraph nodes={graphData.nodes} edges={graphData.edges} className="w-full h-full" />
                  </div>
                  <div className="mt-2 pt-2 border-t border-line/[0.08]">
                    <GraphLegend />
                    <p className="mt-1.5 text-[10px] text-content-subtle">
                      Node size is importance. Dashed outlines are superseded or archived memories,
                      kept so revision history stays visible.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="min-h-[300px]">
                  <p className="text-xs text-content-subtle mb-3 leading-relaxed">
                    Read the memory store as it existed in the past. CockroachDB keeps superseded row
                    versions, so this is the agent's actual former belief state — not a reconstruction.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <input
                      value={travelQuery}
                      onChange={(e) => setTravelQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runBeliefDiff()}
                      placeholder="What topic? e.g. deployment schedule"
                      className="flex-1 bg-surface-sunken rounded-xl px-3 py-2 text-sm text-content placeholder:text-content-subtle border border-line/[0.10] focus:border-accent/40 focus:outline-none"
                    />
                    <select
                      value={travelAt}
                      onChange={(e) => setTravelAt(e.target.value)}
                      className="bg-surface-sunken rounded-xl px-3 py-2 text-sm text-content border border-line/[0.10] focus:border-accent/40 focus:outline-none"
                    >
                      <option value="-5m">5 minutes ago</option>
                      <option value="-1h">1 hour ago</option>
                      <option value="-6h">6 hours ago</option>
                      <option value="-1d">1 day ago</option>
                      <option value="-3d">3 days ago</option>
                    </select>
                    <button
                      onClick={runBeliefDiff}
                      disabled={diffLoading || !travelQuery.trim()}
                      className="rounded-xl bg-accent/[0.15] border border-accent/30 text-accent px-4 py-2 text-sm font-medium hover:bg-accent/30 transition-all disabled:opacity-40"
                    >
                      {diffLoading ? 'Reading…' : 'Compare'}
                    </button>
                  </div>

                  {diff && (
                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                      {([
                        ['Learned since then', diff.learned, 'emerald'],
                        ['Changed or corrected', diff.changed, 'amber'],
                        ['Unchanged', diff.unchanged, 'ink'],
                      ] as const).map(([label, group, tone]) => (
                        <div key={label}>
                          <div className={`text-[10px] font-mono mb-1 ${
                            tone === 'emerald' ? 'text-positive'
                              : tone === 'amber' ? 'text-warning' : 'text-content-subtle'
                          }`}>
                            {label} ({group.length})
                          </div>
                          {group.length === 0 ? (
                            <div className="text-xs text-content-subtle pl-2">none</div>
                          ) : (
                            group.map((m) => (
                              <div key={m.id} className="text-xs text-content-muted pl-2 py-0.5 border-l border-line/[0.12]">
                                {m.content}
                              </div>
                            ))
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!diff && !diffLoading && (
                    <div className="text-center py-8 text-sm text-content-subtle">
                      Enter a topic to compare past and present belief.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Composition + operations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-accent" />
                  <h3 className="text-sm font-semibold text-content">Memory Composition</h3>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: 'Episodic', hint: 'things that happened', value: stats?.episodic ?? 0, color: VIZ.cyan },
                    { label: 'Semantic', hint: 'durable facts', value: stats?.semantic ?? 0, color: VIZ.emerald },
                    { label: 'Procedural', hint: 'learned how-to', value: stats?.procedural ?? 0, color: VIZ.violet },
                  ].map((row) => {
                    const total = Math.max(1, stats?.total ?? 0);
                    return (
                      <div key={row.label} className="flex items-center gap-3">
                        <div
                          // The count stays in the body colour: the tint, the border and the bar already
                          // carry the category, and those are non-text so they only owe 3:1.
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-content"
                          style={{ backgroundColor: viz(row.color, 0.12), border: `1px solid ${viz(row.color, 0.35)}` }}
                        >
                          {row.value}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-content">{row.label}</div>
                          <div className="text-[10px] text-content-subtle truncate">{row.hint}</div>
                        </div>
                        <div className="w-14 h-1.5 rounded-full bg-line/[0.10] overflow-hidden shrink-0">
                          <div className="h-full rounded-full" style={{ width: `${(row.value / total) * 100}%`, backgroundColor: viz(row.color) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-3 border-t border-line/[0.08]">
                  <div className="text-[10px] text-content-subtle mb-2">Maintenance</div>
                  <div className="flex gap-2">
                    <button
                      onClick={runConsolidation}
                      className="flex-1 rounded-lg bg-positive/15 border border-positive/25 text-positive px-2 py-1.5 coarse:py-2 coarse:min-h-[44px] text-[11px] font-medium hover:bg-positive/25 transition-all"
                    >
                      Consolidate
                    </button>
                    <button
                      onClick={runDecay}
                      className="flex-1 rounded-lg bg-line/[0.04] border border-line/[0.12] text-content-muted px-2 py-1.5 coarse:py-2 coarse:min-h-[44px] text-[11px] font-medium hover:bg-line/[0.08] transition-all"
                    >
                      Apply decay
                    </button>
                  </div>
                  {maintenance && <p className="mt-2 text-[10px] text-content-subtle leading-snug">{maintenance}</p>}
                </div>
              </div>

              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-positive" />
                  <h3 className="text-sm font-semibold text-content">Recent Operations</h3>
                </div>
                <div className="space-y-2.5">
                  {audit.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2.5">
                      <div className={`shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center ${
                        entry.operation === 'recall' ? 'bg-accent/[0.15]' : 'bg-positive/20'
                      }`}>
                        {entry.operation === 'recall'
                          ? <Search className="w-2.5 h-2.5 text-accent" />
                          : <Brain className="w-2.5 h-2.5 text-positive" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-content truncate">{entry.query ?? entry.operation}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] text-content-subtle">{entry.operation}</span>
                          <span className="text-[9px] text-content-subtle">{entry.result_ids.length} result(s)</span>
                          {entry.latency_ms != null && (
                            <span className="text-[9px] px-1.5 rounded bg-line/[0.10] text-content-subtle font-mono">
                              {entry.latency_ms}ms
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {audit.length === 0 && (
                    <div className="text-xs text-content-subtle py-2">No operations logged yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
