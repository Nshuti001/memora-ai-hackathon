import { useEffect, useRef, useState } from 'react';
import {
  Send, Search, Bot, User, Clock, Activity, CheckCircle2,
  Brain, TrendingUp, Tag, Zap, MessageSquare,
  RefreshCw, ArrowRight, CircleDot
} from 'lucide-react';
import KnowledgeGraph from '../components/KnowledgeGraph';

interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  memories?: string[];
}

const initialMessages: ChatMessage[] = [
  {
    role: 'user',
    content: 'What did the user ask about last week regarding the API migration?',
  },
  {
    role: 'agent',
    content: 'Last Tuesday, the user asked about the timeline for migrating from REST to GraphQL. I recommended a phased approach starting with the authentication endpoints. The user agreed and asked me to draft a migration plan.',
    memories: ['api-migration-plan', 'user-preference-phased-rollout', 'graphql-auth-endpoints'],
  },
  {
    role: 'user',
    content: 'Great. Can you summarize the key decisions from that conversation?',
  },
  {
    role: 'agent',
    content: 'Three key decisions were made: (1) Migrate auth endpoints first over 2 weeks, (2) Use Apollo Server for the GraphQL layer, (3) Maintain REST endpoints in parallel during transition. The user prioritized zero-downtime migration.',
    memories: ['apollo-server-decision', 'zero-downtime-requirement', 'parallel-rest-graphql'],
  },
];

const memories = [
  { id: 'mem-001', title: 'User prefers dark mode interfaces', time: '2 min ago', importance: 92, confidence: 98, tags: ['preference', 'ui'], category: 'User Preferences' },
  { id: 'mem-002', title: 'API migration plan: REST → GraphQL', time: '3 days ago', importance: 88, confidence: 95, tags: ['api', 'migration', 'graphql'], category: 'Technical Decisions' },
  { id: 'mem-003', title: 'Team uses Slack for daily standups', time: '1 week ago', importance: 65, confidence: 90, tags: ['workflow', 'communication'], category: 'Team Workflow' },
  { id: 'mem-004', title: 'Production deploy scheduled for Fridays', time: '1 week ago', importance: 78, confidence: 92, tags: ['devops', 'deploy'], category: 'DevOps' },
  { id: 'mem-005', title: 'User timezone: PST (UTC-8)', time: '2 weeks ago', importance: 71, confidence: 100, tags: ['preference', 'timezone'], category: 'User Preferences' },
  { id: 'mem-006', title: 'Q4 OKR: reduce API latency by 40%', time: '2 weeks ago', importance: 85, confidence: 88, tags: ['okr', 'performance'], category: 'Business Goals' },
];

const agents = [
  { name: 'Atlas', status: 'active', task: 'Processing user query', color: '#22d3ee' },
  { name: 'Nova', status: 'active', task: 'Memory consolidation', color: '#34d399' },
  { name: 'Echo', status: 'idle', task: 'Awaiting input', color: '#7a8aa8' },
  { name: 'Forge', status: 'active', task: 'Vector indexing', color: '#22d3ee' },
];

const tasks = [
  { title: 'Migrate auth endpoints to GraphQL', status: 'in-progress', agent: 'Atlas', priority: 'high' },
  { title: 'Review memory decay policy', status: 'pending', agent: 'Nova', priority: 'medium' },
  { title: 'Update knowledge graph schema', status: 'completed', agent: 'Forge', priority: 'low' },
  { title: 'Sync cross-agent memory namespace', status: 'in-progress', agent: 'Nova', priority: 'high' },
];

const decisions = [
  { title: 'Adopted Apollo Server for GraphQL', agent: 'Atlas', time: '3d ago', confidence: 95 },
  { title: 'Set memory retention to 90 days', agent: 'Nova', time: '1w ago', confidence: 88 },
  { title: 'Enabled multi-agent memory sharing', agent: 'Echo', time: '2w ago', confidence: 92 },
];

const agentResponses = [
  "Based on the user's memory profile, they prefer concise technical summaries. Here's what I found: the migration plan is 60% complete with auth endpoints done. Next phase covers the billing API.",
  "I recall from our last conversation that you wanted zero-downtime deployment. I've prepared a canary release strategy that maintains both REST and GraphQL endpoints during the transition.",
  "From the memory graph, I can see three related decisions: the Apollo Server choice, the phased rollout preference, and the parallel-endpoint requirement. All three are on track.",
  "The user's past interactions show a strong preference for documentation alongside code changes. I've generated API docs for the new GraphQL endpoints and attached them to this memory.",
];

export default function DashboardPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'timeline' | 'graph'>('timeline');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = { role: 'user', content: input };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      const response = agentResponses[Math.floor(Math.random() * agentResponses.length)];
      const agentMsg: ChatMessage = {
        role: 'agent',
        content: response,
        memories: ['retrieved-context-001', 'user-preference-concise', 'migration-progress'],
      };
      setMessages((m) => [...m, agentMsg]);
      setIsTyping(false);
    }, 1800);
  };

  const filteredMemories = memories.filter(
    (m) =>
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="pt-28 pb-12 min-h-screen">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Agent Dashboard</h1>
            <p className="text-sm text-ink-400 mt-1">Live memory intelligence for your autonomous agents</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="glass rounded-xl px-3 py-2 flex items-center gap-2">
              <CircleDot className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-ink-200">All systems operational</span>
            </div>
          </div>
        </div>

        {/* Top stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Memories', value: '1,284', icon: Brain, color: 'brand' },
            { label: 'Active Agents', value: '3 / 4', icon: Bot, color: 'emerald' },
            { label: 'Avg Importance', value: '78.5', icon: TrendingUp, color: 'brand' },
            { label: 'Recall Latency', value: '42ms', icon: Zap, color: 'emerald' },
          ].map((s, i) => (
            <div key={i} className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-400">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.color === 'brand' ? 'text-brand-400' : 'text-emerald-400'}`} />
              </div>
              <div className="font-display text-2xl font-bold text-white">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Chat */}
          <div className="lg:col-span-5 glass rounded-2xl flex flex-col h-[600px]">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
              <div className="w-9 h-9 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center">
                <Bot className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Atlas Agent</div>
                <div className="text-xs text-emerald-400 flex items-center gap-1">
                  <CircleDot className="w-2.5 h-2.5" /> Active · 3 memories recalled
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    msg.role === 'user' ? 'bg-ink-700' : 'bg-brand-500/15 border border-brand-500/20'
                  }`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-ink-300" /> : <Bot className="w-4 h-4 text-brand-400" />}
                  </div>
                  <div className={`max-w-[80%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user' ? 'bg-ink-700 text-ink-100' : 'glass text-ink-100'
                    }`}>
                      {msg.content}
                    </div>
                    {msg.memories && (
                      <div className="flex flex-wrap gap-1.5 mt-2 justify-start">
                        {msg.memories.map((mem, j) => (
                          <span key={j} className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 text-[10px] font-mono text-brand-300">
                            <Brain className="w-2.5 h-2.5" /> {mem}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-brand-400" />
                  </div>
                  <div className="glass rounded-2xl px-4 py-3 flex gap-1.5">
                    {[0, 1, 2].map((d) => (
                      <div key={d} className="w-2 h-2 rounded-full bg-brand-400 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="px-4 py-3 border-t border-white/[0.06]">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Ask Atlas anything..."
                  className="flex-1 bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                />
                <button
                  onClick={sendMessage}
                  className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 flex items-center justify-center hover:shadow-lg hover:shadow-brand-500/30 transition-all"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Memory panel */}
          <div className="lg:col-span-7 space-y-4">
            {/* Search + tabs */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search memories by meaning, tag, or category..."
                    className="w-full bg-ink-900/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                  />
                </div>
                <div className="flex glass rounded-xl p-1">
                  <button
                    onClick={() => setActiveTab('timeline')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === 'timeline' ? 'bg-brand-500/20 text-brand-300' : 'text-ink-400 hover:text-white'}`}
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => setActiveTab('graph')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === 'graph' ? 'bg-brand-500/20 text-brand-300' : 'text-ink-400 hover:text-white'}`}
                  >
                    Graph
                  </button>
                </div>
              </div>

              {activeTab === 'timeline' ? (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {filteredMemories.map((m) => (
                    <div key={m.id} className="glass rounded-xl p-3 hover:bg-white/[0.04] transition-all cursor-pointer group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3 h-3 text-ink-500 shrink-0" />
                            <span className="text-[10px] font-mono text-ink-500">{m.time}</span>
                            <span className="text-[10px] text-ink-600">·</span>
                            <span className="text-[10px] text-ink-400">{m.category}</span>
                          </div>
                          <p className="text-sm text-white truncate group-hover:text-brand-300 transition-colors">{m.title}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {m.tags.map((t, j) => (
                              <span key={j} className="inline-flex items-center gap-0.5 rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-mono text-ink-400">
                                <Tag className="w-2 h-2" /> {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="flex items-center gap-1 mb-1">
                            <div className="w-16 h-1.5 rounded-full bg-ink-700 overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-emerald-400" style={{ width: `${m.importance}%` }} />
                            </div>
                            <span className="text-[9px] font-mono text-ink-400 w-6">{m.importance}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-16 h-1.5 rounded-full bg-ink-700 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${m.confidence}%` }} />
                            </div>
                            <span className="text-[9px] font-mono text-ink-400 w-6">{m.confidence}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredMemories.length === 0 && (
                    <div className="text-center py-8 text-sm text-ink-500">No memories found for "{searchQuery}"</div>
                  )}
                </div>
              ) : (
                <div className="h-[260px] flex items-center justify-center">
                  <KnowledgeGraph className="w-full h-full max-w-[280px]" />
                </div>
              )}
            </div>

            {/* Agents + Tasks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Agent status */}
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-brand-400" />
                  <h3 className="text-sm font-semibold text-white">Agent Status</h3>
                </div>
                <div className="space-y-2.5">
                  {agents.map((a, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${a.color}15`, border: `1px solid ${a.color}30`, color: a.color }}>
                          {a.name[0]}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-ink-950 ${a.status === 'active' ? 'bg-emerald-400' : 'bg-ink-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white">{a.name}</div>
                        <div className="text-[10px] text-ink-400 truncate">{a.task}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active tasks */}
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Active Tasks</h3>
                </div>
                <div className="space-y-2.5">
                  {tasks.map((t, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className={`shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center ${
                        t.status === 'completed' ? 'bg-emerald-500/20' : t.status === 'in-progress' ? 'bg-brand-500/20' : 'bg-ink-700'
                      }`}>
                        {t.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        {t.status === 'in-progress' && <RefreshCw className="w-3 h-3 text-brand-400 animate-spin" style={{ animationDuration: '3s' }} />}
                        {t.status === 'pending' && <div className="w-1.5 h-1.5 rounded-full bg-ink-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">{t.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] text-ink-500">{t.agent}</span>
                          <span className={`text-[9px] px-1.5 rounded ${
                            t.priority === 'high' ? 'bg-red-500/15 text-red-300' : t.priority === 'medium' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-ink-700 text-ink-400'
                          }`}>{t.priority}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent decisions */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-semibold text-white">Recent Decisions</h3>
              </div>
              <div className="space-y-2">
                {decisions.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shrink-0">
                        <ArrowRight className="w-3 h-3 text-brand-400" />
                      </div>
                      <span className="text-xs text-white truncate">{d.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] text-ink-500">{d.time}</span>
                      <div className="flex items-center gap-1">
                        <div className="w-12 h-1 rounded-full bg-ink-700 overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${d.confidence}%` }} />
                        </div>
                        <span className="text-[9px] font-mono text-emerald-400">{d.confidence}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
