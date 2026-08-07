import { useState } from 'react';
import { Code2, Package, Terminal, Webhook, Zap, ArrowRight, Copy, Check } from 'lucide-react';
import { navigateTo } from '../router';

const sdks = [
  { name: 'TypeScript', install: 'npm install @memora/ai', icon: Code2 },
  { name: 'Python', install: 'pip install memora-ai', icon: Terminal },
  { name: 'Go', install: 'go get github.com/memora/ai-go', icon: Package },
  { name: 'Rust', install: 'cargo add memora-ai', icon: Zap },
];

const codeExamples: Record<string, string> = {
  TypeScript: `import { Memora } from '@memora/ai';

const memora = new Memora({ apiKey: 'mk_live_...' });

// Store a memory
await memora.remember({
  agent: 'support-bot',
  content: 'User prefers email replies, timezone PST',
  metadata: { priority: 1 },
});

// Recall relevant memories
const memories = await memora.recall({
  agent: 'support-bot',
  query: 'How should I contact the user?',
  limit: 5,
});`,
  Python: `from memora import Memora

memora = Memora(api_key='mk_live_...')

# Store a memory
memora.remember(
    agent='support-bot',
    content='User prefers email replies, timezone PST',
    metadata={'priority': 1},
)

# Recall relevant memories
memories = memora.recall(
    agent='support-bot',
    query='How should I contact the user?',
    limit=5,
)`,
  Go: `package main

import "github.com/memora/ai-go"

func main() {
    m := memora.New("mk_live_...")

    // Store a memory
    m.Remember(memora.Memory{
        Agent:   "support-bot",
        Content: "User prefers email replies, timezone PST",
    })

    // Recall relevant memories
    memories := m.Recall(memora.RecallReq{
        Agent:  "support-bot",
        Query:  "How should I contact the user?",
        Limit:  5,
    })
}`,
  Rust: `use memora_ai::Memora;

let memora = Memora::new("mk_live_...");

// Store a memory
memora.remember(Memory {
    agent: "support-bot",
    content: "User prefers email replies, timezone PST",
    metadata: Some({"priority": 1}),
}).await?;

// Recall relevant memories
let memories = memora.recall(RecallReq {
    agent: "support-bot",
    query: "How should I contact the user?",
    limit: 5,
}).await?;`,
};

const features = [
  { icon: Terminal, title: 'REST API', desc: 'Full CRUD access to memories, agents, and namespaces. JSON in, JSON out. Rate-limited and authenticated via Bearer tokens.' },
  { icon: Code2, title: 'SDKs in 4 languages', desc: 'Official SDKs for TypeScript, Python, Go, and Rust. Auto-generated from our OpenAPI spec with full type safety.' },
  { icon: Webhook, title: 'Webhooks', desc: 'Subscribe to memory events: writes, updates, decay, conflicts. Build reactive pipelines that respond to memory changes in real time.' },
  { icon: Zap, title: 'Streaming', desc: 'WebSocket channels for real-time memory sync across agents. Sub-100ms propagation with automatic reconnection.' },
];

export default function DevelopersPage() {
  const [activeSdk, setActiveSdk] = useState('TypeScript');
  const [copied, setCopied] = useState(false);

  const copyInstall = () => {
    const sdk = sdks.find((s) => s.name === activeSdk)!;
    navigator.clipboard.writeText(sdk.install);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-accent tracking-wide uppercase">Developer Portal</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-content">
            Build agents that
            <br />
            <span className="text-gradient-brand">never forget</span>
          </h1>
          <p className="mt-6 text-lg text-content-muted max-w-2xl mx-auto">
            Integrate Memora AI in under five minutes. REST APIs, official SDKs,
            and webhooks for every language and stack.
          </p>
        </div>

        {/* SDK tabs + code */}
        <div className="glass-strong rounded-3xl p-6 sm:p-8 mb-12">
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {sdks.map((sdk) => (
              <button
                key={sdk.name}
                onClick={() => setActiveSdk(sdk.name)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                  activeSdk === sdk.name ? 'bg-accent/[0.12] text-accent border border-accent/25' : 'glass text-content-muted hover:text-content'
                }`}
              >
                <sdk.icon className="w-4 h-4" />
                {sdk.name}
              </button>
            ))}
          </div>

          {/* Install command */}
          <div className="flex items-center justify-between glass rounded-xl px-4 py-3 mb-4">
            <code className="text-sm font-mono text-content-muted">
              {sdks.find((s) => s.name === activeSdk)!.install}
            </code>
            <button onClick={copyInstall} className="text-content-subtle hover:text-content transition-colors">
              {copied ? <Check className="w-4 h-4 text-positive" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* Code example */}
          <div className="rounded-xl overflow-hidden bg-surface border border-line/[0.10]">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line/[0.10]">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400 dark:bg-red-400/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 dark:bg-yellow-400/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400 dark:bg-green-400/60" />
              </div>
              <span className="text-xs text-content-subtle ml-2 font-mono">example.{activeSdk === 'TypeScript' ? 'ts' : activeSdk === 'Python' ? 'py' : activeSdk === 'Go' ? 'go' : 'rs'}</span>
            </div>
            <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto text-content-muted">
              <code>{codeExamples[activeSdk]}</code>
            </pre>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
          {features.map((f, i) => (
            <div key={i} className="group glass rounded-2xl p-6 hover:bg-line/[0.05] transition-all duration-300 hover:-translate-y-1 flex gap-5">
              <div className="shrink-0 w-12 h-12 rounded-xl bg-accent/[0.10] border border-accent/25 flex items-center justify-center group-hover:bg-accent/[0.15] transition-colors">
                <f.icon className="w-6 h-6 text-accent" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold text-content mb-2">{f.title}</h3>
                <p className="text-sm text-content-muted leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Resources */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {[
            { title: 'API Reference', desc: 'Full REST API documentation with examples.', action: 'View docs', route: 'docs' as const },
            { title: 'Quick Start Guide', desc: 'Get from zero to remembering in 5 minutes.', action: 'Read guide', route: 'docs' as const },
            { title: 'Community', desc: 'Join our Discord and GitHub discussions.', action: 'Join us', route: 'contact' as const },
          ].map((r, i) => (
            <div key={i} className="glass rounded-2xl p-5 hover:bg-line/[0.04] transition-all">
              <h3 className="text-sm font-semibold text-content mb-1.5">{r.title}</h3>
              <p className="text-xs text-content-subtle mb-3">{r.desc}</p>
              <button
                onClick={() => navigateTo(r.route)}
                className="group inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent transition-colors"
              >
                {r.action}
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => navigateTo('signup')}
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-7 py-3.5 text-base font-semibold hover:shadow-2xl hover:shadow-brand-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            Get your API key
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
