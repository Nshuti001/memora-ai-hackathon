import { ArrowRight, Play, Database, Zap, Clock, Shield, Globe, Sparkles } from 'lucide-react';
import MemoryVisualization from '../components/MemoryVisualization';
import { navigateTo } from '../router';
import { useReveal } from '../hooks/useReveal';

const trustStats = [
  { icon: Database, value: '1024-d', label: 'Titan V2 embeddings' },
  { icon: Zap, value: 'ANN', label: 'Distributed vector index' },
  { icon: Clock, value: 'Serializable', label: 'Transactional writes' },
  { icon: Globe, value: 'AWS', label: 'Lambda + Bedrock' },
];

const features = [
  { icon: Database, title: 'Persistent Memory', desc: 'Memories survive across sessions, restarts, and model swaps. Your agent never forgets.' },
  { icon: Sparkles, title: 'Semantic Search', desc: 'Find memories by meaning, not keywords. Vector-embedded retrieval at millisecond speed.' },
  { icon: Zap, title: 'Real-Time Sync', desc: 'Multi-agent memory sync in real time. What one agent learns, all agents know.' },
  { icon: Shield, title: 'Tenant Isolation', desc: 'The vector index is prefixed by tenant and agent, so one agent\'s recall never scans another\'s memories.' },
];

const pipeline = ['User', 'AI Agent', 'Amazon Bedrock', 'CockroachDB', 'Vector Index', 'Retrieval', 'Response', 'Memory Update'];

export default function HomePage() {
  const featuresReveal = useReveal<HTMLDivElement>();
  const pipelineReveal = useReveal<HTMLDivElement>();
  const statsReveal = useReveal<HTMLDivElement>();

  return (
    <div>
      {/* Hero */}
      <section className="relative min-h-screen flex items-center pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 grid-bg radial-fade" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/[0.15] blur-[120px] animate-glow" />
        <div className="absolute top-1/3 right-10 w-[300px] h-[300px] rounded-full bg-positive/10 blur-[100px] animate-pulse-slow" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 mb-8 animate-fade-up">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-content-muted tracking-wide">
                  Built on CockroachDB Cloud &amp; Amazon Bedrock
                </span>
              </div>

              <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] animate-fade-up animate-delay-100" style={{ opacity: 0 }}>
                Every AI Agent
                <br />
                <span className="text-gradient-brand">Remembers.</span>
              </h1>

              <p className="mt-6 text-lg sm:text-xl text-content-muted leading-relaxed max-w-xl mx-auto lg:mx-0 animate-fade-up animate-delay-200" style={{ opacity: 0 }}>
                Memora AI is the memory layer for autonomous AI. Persistent,
                searchable, production-grade memory powered by CockroachDB and
                AWS — so your agents recall, reason, and act with continuity.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-4 animate-fade-up animate-delay-300" style={{ opacity: 0 }}>
                <button
                  onClick={() => navigateTo('signup')}
                  className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-7 py-3.5 text-base font-semibold hover:shadow-2xl hover:shadow-brand-500/40 transition-all duration-300 hover:-translate-y-0.5"
                >
                  Get Started
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => navigateTo('dashboard')}
                  className="group inline-flex items-center gap-2 rounded-xl glass px-7 py-3.5 text-base font-medium text-content hover:bg-line/[0.06] transition-all duration-200"
                >
                  <Play className="w-4 h-4 text-accent" />
                  Watch Demo
                </button>
              </div>

              <div className="mt-12 flex flex-wrap items-center lg:justify-start justify-center gap-x-8 gap-y-3 text-sm text-content-subtle animate-fade-up animate-delay-400" style={{ opacity: 0 }}>
                {trustStats.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-2">
                    <s.icon className="w-4 h-4 text-accent" /> {s.value} {s.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex justify-center lg:justify-end animate-fade-in animate-delay-300">
              <div className="relative w-full max-w-md lg:max-w-lg">
                <MemoryVisualization />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section ref={statsReveal.ref} className={`relative py-16 border-y border-line/[0.10] ${statsReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: 'L2', label: 'Index-accelerated distance' },
              { value: '3', label: 'Memory types modeled' },
              { value: 'Every', label: 'Recall audited' },
              { value: 'Soft', label: 'Supersession, never deletion' },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="font-display text-4xl sm:text-5xl font-bold text-gradient-brand">{s.value}</div>
                <div className="mt-2 text-sm text-content-subtle">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features preview */}
      <section ref={featuresReveal.ref} className={`relative py-24 sm:py-32 ${featuresReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <span className="text-sm font-semibold text-accent tracking-wide uppercase">Features</span>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl font-bold tracking-tight text-content">
              Everything your agent needs to{' '}
              <span className="text-gradient-brand">remember</span>
            </h2>
            <p className="mt-4 text-lg text-content-muted">
              A complete memory infrastructure layer — not a wrapper around a vector DB.
              Built for production autonomous agents from day one.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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

          <div className="text-center mt-10">
            <button
              onClick={() => navigateTo('features')}
              className="group inline-flex items-center gap-2 px-3 py-2 coarse:py-3 coarse:min-h-[44px] -my-1 rounded-lg text-sm font-semibold text-accent hover:bg-line/[0.05] transition-colors"
            >
              Explore all 10 features
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* Pipeline preview */}
      <section ref={pipelineReveal.ref} className={`relative py-24 border-t border-line/[0.10] ${pipelineReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <span className="text-sm font-semibold text-accent tracking-wide uppercase">How it Works</span>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl font-bold tracking-tight text-content">
              From input to memory in{' '}
              <span className="text-gradient-brand">milliseconds</span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {pipeline.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="glass rounded-xl px-4 py-2.5 text-sm font-medium text-content-muted hover:text-content hover:bg-line/[0.06] transition-all">
                  {step}
                </div>
                {i < pipeline.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-content-subtle hidden sm:block" />
                )}
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <button
              onClick={() => navigateTo('how-it-works')}
              className="group inline-flex items-center gap-2 px-3 py-2 coarse:py-3 coarse:min-h-[44px] -my-1 rounded-lg text-sm font-semibold text-accent hover:bg-line/[0.05] transition-colors"
            >
              See the full pipeline
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 sm:py-32 border-t border-line/[0.10]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="relative glass-strong rounded-3xl p-10 sm:p-16 text-center overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full bg-accent/[0.15] blur-[100px]" />
            <div className="relative">
              <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-content">
                Give your agents a{' '}
                <span className="text-gradient-brand">memory that lasts</span>
              </h2>
              <p className="mt-5 text-lg text-content-muted max-w-xl mx-auto">
                Join 500+ teams building autonomous agents that never forget.
                Start free in under five minutes.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => navigateTo('signup')}
                  className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-7 py-3.5 text-base font-semibold hover:shadow-2xl hover:shadow-brand-500/40 transition-all duration-300 hover:-translate-y-0.5"
                >
                  Get your API key
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => navigateTo('docs')}
                  className="inline-flex items-center gap-2 rounded-xl glass px-7 py-3.5 text-base font-medium text-content hover:bg-line/[0.06] transition-all"
                >
                  Read the docs
                </button>
              </div>
              <p className="mt-6 text-sm text-content-subtle">No credit card required · 10K memories free · Cancel anytime</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
