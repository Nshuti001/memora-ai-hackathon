import { useState } from 'react';
import { Copy, Check, Terminal, Book, Code2, Webhook, Key } from 'lucide-react';

const endpoints = [
  {
    method: 'POST',
    path: '/v1/memories',
    title: 'Create Memory',
    desc: 'Store a new memory for an agent. Memora handles embedding, deduplication, and indexing automatically.',
    code: `curl -X POST https://api.memora.ai/v1/memories \\
  -H "Authorization: Bearer mk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "support-bot",
    "content": "User prefers email replies, timezone PST",
    "metadata": { "priority": 1, "source": "chat" },
    "tags": ["preference", "communication"]
  }'`,
    response: `{
  "id": "mem_a1b2c3d4",
  "agent_id": "support-bot",
  "content": "User prefers email replies...",
  "embedding": [0.0234, -0.0156, ...],
  "importance_score": 0.92,
  "confidence": 0.98,
  "created_at": "2026-07-07T12:00:00Z"
}`,
  },
  {
    method: 'POST',
    path: '/v1/memories/recall',
    title: 'Recall Memories',
    desc: 'Semantic search across an agent\'s memory. Returns the most relevant memories by meaning, not keywords.',
    code: `curl -X POST https://api.memora.ai/v1/memories/recall \\
  -H "Authorization: Bearer mk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "support-bot",
    "query": "How should I contact the user?",
    "limit": 5,
    "min_confidence": 0.7
  }'`,
    response: `{
  "memories": [
    {
      "id": "mem_a1b2c3d4",
      "content": "User prefers email replies, timezone PST",
      "score": 0.94,
      "confidence": 0.98,
      "tags": ["preference", "communication"]
    }
  ],
  "latency_ms": 42
}`,
  },
  {
    method: 'GET',
    path: '/v1/memories/:id',
    title: 'Get Memory',
    desc: 'Retrieve a specific memory by its ID, including full metadata and embedding vector.',
    code: `curl https://api.memora.ai/v1/memories/mem_a1b2c3d4 \\
  -H "Authorization: Bearer mk_live_..."`,
    response: `{
  "id": "mem_a1b2c3d4",
  "agent_id": "support-bot",
  "content": "User prefers email replies...",
  "metadata": { "priority": 1 },
  "importance_score": 0.92,
  "confidence": 0.98,
  "tags": ["preference"],
  "created_at": "2026-07-07T12:00:00Z",
  "updated_at": "2026-07-07T12:00:00Z"
}`,
  },
  {
    method: 'DELETE',
    path: '/v1/memories/:id',
    title: 'Delete Memory',
    desc: 'Permanently remove a memory. This action is irreversible and triggers a graph reindex.',
    code: `curl -X DELETE https://api.memora.ai/v1/memories/mem_a1b2c3d4 \\
  -H "Authorization: Bearer mk_live_..."`,
    response: `{
  "id": "mem_a1b2c3d4",
  "deleted": true,
  "graph_reindexed": true
}`,
  },
  {
    method: 'POST',
    path: '/v1/agents',
    title: 'Register Agent',
    desc: 'Create a new agent with a memory namespace. Agents can share namespaces for multi-agent collaboration.',
    code: `curl -X POST https://api.memora.ai/v1/agents \\
  -H "Authorization: Bearer mk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "support-bot",
    "model": "anthropic.claude-3-sonnet",
    "memory_namespace": "customer-support",
    "retention_days": 90
  }'`,
    response: `{
  "agent_id": "agt_x1y2z3",
  "name": "support-bot",
  "memory_namespace": "customer-support",
  "status": "active",
  "created_at": "2026-07-07T12:00:00Z"
}`,
  },
];

const methodColors: Record<string, string> = {
  GET: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  POST: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
  DELETE: 'text-red-400 bg-red-500/10 border-red-500/20',
  PUT: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

export default function DocsPage() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const active = endpoints[activeIdx];

  const copyCode = () => {
    navigator.clipboard.writeText(active.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">Documentation</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-white">
            Interactive API
            <br />
            <span className="text-gradient-brand">documentation</span>
          </h1>
          <p className="mt-6 text-lg text-ink-300 max-w-2xl mx-auto">
            Everything you need to integrate Memora AI into your agents.
            Copy, paste, and start remembering.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-3">
            <div className="glass rounded-2xl p-4 sticky top-28">
              <div className="flex items-center gap-2 mb-4 px-2">
                <Book className="w-4 h-4 text-brand-400" />
                <span className="text-sm font-semibold text-white">API Reference</span>
              </div>
              <nav className="space-y-1">
                {endpoints.map((ep, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all ${
                      activeIdx === i ? 'bg-brand-500/10 text-brand-300' : 'text-ink-300 hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${methodColors[ep.method]}`}>
                      {ep.method}
                    </span>
                    <span className="text-xs truncate">{ep.title}</span>
                  </button>
                ))}
              </nav>

              <div className="mt-6 pt-4 border-t border-white/[0.06] space-y-1">
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-400">
                  <Key className="w-3.5 h-3.5" /> Authentication
                </div>
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-400">
                  <Webhook className="w-3.5 h-3.5" /> Webhooks
                </div>
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-400">
                  <Code2 className="w-3.5 h-3.5" /> SDKs
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="lg:col-span-9 space-y-6">
            {/* Endpoint header */}
            <div className="glass rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-xs font-mono font-bold px-2 py-1 rounded border ${methodColors[active.method]}`}>
                  {active.method}
                </span>
                <code className="text-sm font-mono text-ink-200">{active.path}</code>
              </div>
              <h2 className="font-display text-xl font-semibold text-white mb-2">{active.title}</h2>
              <p className="text-sm text-ink-300 leading-relaxed">{active.desc}</p>
            </div>

            {/* Request */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-medium text-white">Request</span>
                </div>
                <button
                  onClick={copyCode}
                  className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto text-ink-200">
                <code>{active.code}</code>
              </pre>
            </div>

            {/* Response */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06]">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm font-medium text-white">Response · 200 OK</span>
              </div>
              <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto text-emerald-300/80">
                <code>{active.response}</code>
              </pre>
            </div>

            {/* Quick start */}
            <div className="glass-strong rounded-2xl p-6">
              <h3 className="font-display text-lg font-semibold text-white mb-4">Quick Start</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xs font-mono text-brand-400">1</div>
                  <div>
                    <p className="text-sm text-white font-medium">Get your API key</p>
                    <p className="text-xs text-ink-400 mt-0.5">Sign up and generate a key from the dashboard.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xs font-mono text-brand-400">2</div>
                  <div>
                    <p className="text-sm text-white font-medium">Install the SDK</p>
                    <p className="text-xs text-ink-400 mt-0.5"><code className="text-brand-300">npm install @memora/ai</code></p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-brand-500/15 border border-brand-500/20 flex items-center justify-center text-xs font-mono text-brand-400">3</div>
                  <div>
                    <p className="text-sm text-white font-medium">Start remembering</p>
                    <p className="text-xs text-ink-400 mt-0.5">Call <code className="text-brand-300">memora.remember()</code> and <code className="text-brand-300">memora.recall()</code>.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
