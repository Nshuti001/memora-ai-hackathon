import { useEffect, useState } from 'react';
import { User, Bot, Cloud, Database, Grid3x3, Search, MessageSquare, RefreshCw, ArrowRight } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';
import { navigateTo } from '../router';

const steps = [
  { icon: User, title: 'User', desc: 'The user sends a message or task to the AI agent.', color: '#22d3ee' },
  { icon: Bot, title: 'AI Agent', desc: 'The agent receives the input and prepares to augment its context with relevant memories.', color: '#34d399' },
  { icon: Cloud, title: 'Amazon Bedrock', desc: 'Bedrock provides the foundation model that powers the agent\'s reasoning and memory extraction.', color: '#22d3ee' },
  { icon: Database, title: 'CockroachDB', desc: 'Memories are stored in CockroachDB\'s distributed SQL database with multi-region replication.', color: '#34d399' },
  { icon: Grid3x3, title: 'Vector Index', desc: 'CockroachDB\'s distributed vector index finds the most relevant memories by semantic similarity.', color: '#22d3ee' },
  { icon: Search, title: 'Memory Retrieval', desc: 'Relevant memories are retrieved, ranked, and injected into the agent\'s context window.', color: '#34d399' },
  { icon: MessageSquare, title: 'AI Response', desc: 'The agent generates a response informed by both the current input and retrieved memories.', color: '#22d3ee' },
  { icon: RefreshCw, title: 'Memory Update', desc: 'The interaction is stored as a new memory, updating the agent\'s knowledge for future use.', color: '#34d399' },
];

export default function HowItWorksPage() {
  const [activeStep, setActiveStep] = useState(0);
  const gridReveal = useReveal<HTMLDivElement>();

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((s) => (s + 1) % steps.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">How it Works</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-white">
            From input to memory in
            <br />
            <span className="text-gradient-brand">milliseconds</span>
          </h1>
          <p className="mt-6 text-lg text-ink-300 max-w-2xl mx-auto">
            Every interaction follows an eight-stage pipeline. Watch how a user
            message becomes a persistent memory your agent can recall forever.
          </p>
        </div>

        {/* Animated pipeline */}
        <div className="glass-strong rounded-3xl p-6 sm:p-10 mb-16">
          <div className="flex flex-col lg:flex-row items-stretch gap-3">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3 flex-1">
                <div
                  className={`flex-1 rounded-2xl p-4 border transition-all duration-500 cursor-pointer ${
                    activeStep === i
                      ? 'glass-strong border-brand-400/40 shadow-lg shadow-brand-500/10 scale-105'
                      : 'glass border-white/[0.06] opacity-60'
                  }`}
                  onClick={() => setActiveStep(i)}
                >
                  <div className="flex flex-col items-center text-center gap-2">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                      style={{ backgroundColor: `${s.color}15`, border: `1px solid ${s.color}30` }}
                    >
                      <s.icon className="w-5 h-5" style={{ color: s.color }} strokeWidth={1.75} />
                    </div>
                    <span className="text-xs font-mono text-ink-400">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-sm font-semibold text-white">{s.title}</span>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <ArrowRight className="hidden lg:block w-4 h-4 text-ink-600 shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Active step detail */}
          <div className="mt-8 glass rounded-2xl p-6 min-h-[120px] flex items-center">
            <div className="flex items-start gap-4 w-full">
              <div
                className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: `${steps[activeStep].color}15`, border: `1px solid ${steps[activeStep].color}30` }}
              >
                {(() => { const Icon = steps[activeStep].icon; return <Icon className="w-7 h-7" style={{ color: steps[activeStep].color }} strokeWidth={1.75} />; })()}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-mono text-xs text-ink-500">Step {String(activeStep + 1).padStart(2, '0')}</span>
                  <h3 className="font-display text-xl font-semibold text-white">{steps[activeStep].title}</h3>
                </div>
                <p className="text-ink-300 leading-relaxed">{steps[activeStep].desc}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed cards */}
        <div ref={gridReveal.ref} className={`grid grid-cols-1 md:grid-cols-2 gap-5 ${gridReveal.revealed ? 'revealed' : ''} reveal`}>
          {steps.map((s, i) => (
            <div
              key={i}
              className={`glass rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.05] hover:-translate-y-1 cursor-pointer ${
                activeStep === i ? 'ring-1 ring-brand-400/30' : ''
              }`}
              onClick={() => setActiveStep(i)}
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${s.color}15`, border: `1px solid ${s.color}30` }}>
                  <s.icon className="w-6 h-6" style={{ color: s.color }} strokeWidth={1.75} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-ink-500">{String(i + 1).padStart(2, '0')}</span>
                    <h3 className="font-display text-lg font-semibold text-white">{s.title}</h3>
                  </div>
                  <p className="text-sm text-ink-300 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <button
            onClick={() => navigateTo('architecture')}
            className="group inline-flex items-center gap-2 rounded-xl glass px-7 py-3.5 text-base font-medium text-white hover:bg-white/[0.06] transition-all"
          >
            Explore the architecture
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
