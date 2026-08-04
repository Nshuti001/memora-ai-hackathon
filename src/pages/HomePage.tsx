import { ArrowRight, Play, Database, Zap, Clock, Shield, Globe, Sparkles } from 'lucide-react';
import MemoryVisualization from '../components/MemoryVisualization';
import { navigateTo } from '../router';
import { useReveal } from '../hooks/useReveal';

const trustStats = [
  { icon: Database, value: '10M+', label: 'Memories stored' },
  { icon: Zap, value: '<50ms', label: 'Recall latency' },
  { icon: Clock, value: '99.999%', label: 'Uptime SLA' },
  { icon: Globe, value: 'Global', label: 'Deployment' },
];

const features = [
  { icon: Database, title: 'Persistent Memory', desc: 'Memories survive across sessions, restarts, and model swaps. Your agent never forgets.' },
  { icon: Sparkles, title: 'Semantic Search', desc: 'Find memories by meaning, not keywords. Vector-embedded retrieval at millisecond speed.' },
  { icon: Zap, title: 'Real-Time Sync', desc: 'Multi-agent memory sync in real time. What one agent learns, all agents know.' },
  { icon: Shield, title: 'Secure Access', desc: 'Role-based access control with per-agent isolation. SOC 2 Type II compliant.' },
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
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-brand-500/20 blur-[120px] animate-glow" />
        <div className="absolute top-1/3 right-10 w-[300px] h-[300px] rounded-full bg-emerald-500/10 blur-[100px] animate-pulse-slow" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 mb-8 animate-fade-up">
                <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                <span className="text-xs font-medium text-ink-200 tracking-wide">
                  Backed by $20M Series A · Powered by CockroachDB & AWS
                </span>
              </div>

              <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] animate-fade-up animate-delay-100" style={{ opacity: 0 }}>
                Every AI Agent
                <br />
                <span className="text-gradient-brand">Remembers.</span>
              </h1>

              <p className="mt-6 text-lg sm:text-xl text-ink-300 leading-relaxed max-w-xl mx-auto lg:mx-0 animate-fade-up animate-delay-200" style={{ opacity: 0 }}>
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
                  className="group inline-flex items-center gap-2 rounded-xl glass px-7 py-3.5 text-base font-medium text-white hover:bg-white/[0.06] transition-all duration-200"
                >
                  <Play className="w-4 h-4 text-brand-400" />
                  Watch Demo
                </button>
              </div>

              <div className="mt-12 flex flex-wrap items-center lg:justify-start justify-center gap-x-8 gap-y-3 text-sm text-ink-400 animate-fade-up animate-delay-400" style={{ opacity: 0 }}>
                {trustStats.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-2">
                    <s.icon className="w-4 h-4 text-brand-400" /> {s.value} {s.label}
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
      <section ref={statsReveal.ref} className={`relative py-16 border-y border-white/[0.06] ${statsReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: '99.999%', label: 'Availability' },
              { value: '10M+', label: 'Memories stored' },
              { value: '<50ms', label: 'Semantic retrieval' },
              { value: 'Zero', label: 'Downtime migrations' },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="font-display text-4xl sm:text-5xl font-bold text-gradient-brand">{s.value}</div>
                <div className="mt-2 text-sm text-ink-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features preview */}
      <section ref={featuresReveal.ref} className={`relative py-24 sm:py-32 ${featuresReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">Features</span>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
              Everything your agent needs to{' '}
              <span className="text-gradient-brand">remember</span>
            </h2>
            <p className="mt-4 text-lg text-ink-300">
              A complete memory infrastructure layer — not a wrapper around a vector DB.
              Built for production autonomous agents from day one.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {features.map((f, i) => (
              <div key={i} className="group glass rounded-2xl p-6 hover:bg-white/[0.05] transition-all duration-300 hover:-translate-y-1 flex gap-5">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center group-hover:bg-brand-500/20 transition-colors">
                  <f.icon className="w-6 h-6 text-brand-400" strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-ink-300 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <button
              onClick={() => navigateTo('features')}
              className="group inline-flex items-center gap-2 text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors"
            >
              Explore all 10 features
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* Pipeline preview */}
      <section ref={pipelineReveal.ref} className={`relative py-24 border-t border-white/[0.06] ${pipelineReveal.revealed ? 'revealed' : ''} reveal`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">How it Works</span>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
              From input to memory in{' '}
              <span className="text-gradient-brand">milliseconds</span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {pipeline.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="glass rounded-xl px-4 py-2.5 text-sm font-medium text-ink-200 hover:text-white hover:bg-white/[0.06] transition-all">
                  {step}
                </div>
                {i < pipeline.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-ink-600 hidden sm:block" />
                )}
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <button
              onClick={() => navigateTo('how-it-works')}
              className="group inline-flex items-center gap-2 text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors"
            >
              See the full pipeline
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 sm:py-32 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="relative glass-strong rounded-3xl p-10 sm:p-16 text-center overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full bg-brand-500/20 blur-[100px]" />
            <div className="relative">
              <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-white">
                Give your agents a{' '}
                <span className="text-gradient-brand">memory that lasts</span>
              </h2>
              <p className="mt-5 text-lg text-ink-300 max-w-xl mx-auto">
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
                  className="inline-flex items-center gap-2 rounded-xl glass px-7 py-3.5 text-base font-medium text-white hover:bg-white/[0.06] transition-all"
                >
                  Read the docs
                </button>
              </div>
              <p className="mt-6 text-sm text-ink-400">No credit card required · 10K memories free · Cancel anytime</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
