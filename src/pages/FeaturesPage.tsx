import {
  Database, Search, Network, Clock, RefreshCw, Users,
  Share2, Shield, Zap, Globe, ArrowRight
} from 'lucide-react';
import { useReveal } from '../hooks/useReveal';
import { navigateTo } from '../router';

const features = [
  { icon: Database, title: 'Persistent Memory', desc: 'Memories survive across sessions, restarts, and model swaps. Your agent picks up exactly where it left off — every time.', color: 'brand' },
  { icon: Search, title: 'Semantic Search', desc: 'Find memories by meaning, not keywords. Vector-embedded retrieval powered by CockroachDB\'s distributed vector index.', color: 'emerald' },
  { icon: Network, title: 'Distributed Vector Memory', desc: 'Memories are replicated across regions with CockroachDB\'s consensus protocol. No single point of failure.', color: 'brand' },
  { icon: Clock, title: 'Memory Timeline', desc: 'Every memory is timestamped and versioned. Replay an agent\'s memory state at any point in time.', color: 'emerald' },
  { icon: RefreshCw, title: 'Autonomous Memory Updates', desc: 'Agents update their own memories via Amazon Bedrock — no manual intervention. Memories decay, merge, and evolve.', color: 'brand' },
  { icon: Users, title: 'Multi-Agent Collaboration', desc: 'Multiple agents share a memory namespace. What one agent learns, the entire team knows instantly.', color: 'emerald' },
  { icon: Share2, title: 'Memory Graph', desc: 'Memories are connected as a knowledge graph. Agents traverse relationships to reason over complex context.', color: 'brand' },
  { icon: Shield, title: 'Secure Role-Based Access', desc: 'Granular RBAC with per-agent isolation, tenant-scoped storage, and SOC 2 Type II compliance.', color: 'emerald' },
  { icon: Zap, title: 'Real-Time Sync', desc: 'Memory changes propagate to all agents in under 100ms via WebSocket channels. No stale context.', color: 'brand' },
  { icon: Globe, title: 'Global Availability', desc: 'Deployed across AWS regions with CockroachDB\'s geo-distributed architecture. 99.999% uptime SLA.', color: 'emerald' },
];

export default function FeaturesPage() {
  const gridReveal = useReveal<HTMLDivElement>();

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">Features</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-white">
            The complete memory
            <br />
            <span className="text-gradient-brand">infrastructure layer</span>
          </h1>
          <p className="mt-6 text-lg text-ink-300 max-w-2xl mx-auto">
            Ten capabilities that turn any AI agent into one that remembers,
            reasons, and improves over time. Powered by CockroachDB and AWS.
          </p>
        </div>

        <div ref={gridReveal.ref} className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 ${gridReveal.revealed ? 'revealed' : ''} reveal`}>
          {features.map((f, i) => (
            <div key={i} className="group relative glass rounded-2xl p-6 hover:bg-white/[0.05] transition-all duration-300 hover:-translate-y-1">
              <div className={`w-12 h-12 rounded-xl ${f.color === 'brand' ? 'bg-brand-500/10 border-brand-500/20' : 'bg-emerald-500/10 border-emerald-500/20'} border flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}>
                <f.icon className={`w-6 h-6 ${f.color === 'brand' ? 'text-brand-400' : 'text-emerald-400'}`} strokeWidth={1.75} />
              </div>
              <h3 className="font-display text-lg font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-ink-300 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <button
            onClick={() => navigateTo('signup')}
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-7 py-3.5 text-base font-semibold hover:shadow-2xl hover:shadow-brand-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            Start building free
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
