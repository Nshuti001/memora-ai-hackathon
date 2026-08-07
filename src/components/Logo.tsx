import { BrainCircuit } from 'lucide-react';

export default function Logo({ className = '', onClick }: { className?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 group ${className}`}>
      <div className="relative">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/30 transition-transform group-hover:scale-105">
          <BrainCircuit className="w-5 h-5 text-ink-950" strokeWidth={2.5} />
        </div>
        <div className="absolute inset-0 rounded-xl bg-accent-bright/40 blur-md -z-10" />
      </div>
      <span className="font-display text-xl font-bold tracking-tight text-content">
        Memora<span className="text-accent"> AI</span>
      </span>
    </button>
  );
}
