import { useEffect, useState } from 'react';
import { VIZ, viz } from '../lib/viz';

export default function MemoryVisualization({ className = '' }: { className?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(interval);
  }, []);

  const nodes = [
    { angle: 0, label: 'episodic', color: VIZ.cyan },
    { angle: 60, label: 'semantic', color: VIZ.emerald },
    { angle: 120, label: 'procedural', color: VIZ.cyan },
    { angle: 180, label: 'context', color: VIZ.emerald },
    { angle: 240, label: 'prefs', color: VIZ.cyan },
    { angle: 300, label: 'history', color: VIZ.emerald },
  ];
  const radius = 130;
  const cx = 200;
  const cy = 200;

  return (
    <div className={`relative select-none ${className}`}>
      <svg viewBox="0 0 400 400" className="w-full h-full">
        <defs>
          <radialGradient id="coreGlowMV" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: viz(VIZ.cyan), stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: viz(VIZ.cyan), stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="lineGradMV" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: viz(VIZ.cyan), stopOpacity: 0.7 }} />
            <stop offset="100%" style={{ stopColor: viz(VIZ.emerald), stopOpacity: 0.3 }} />
          </linearGradient>
        </defs>

        {/* Outer ambient glow */}
        <circle cx={cx} cy={cy} r="100" fill="url(#coreGlowMV)" className="animate-pulse-slow" />

        {/* Orbit rings */}
        {[radius, radius - 40, radius + 40].map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" className="stroke-line/[0.12]" strokeWidth="1" strokeDasharray="4 8" />
        ))}

        {/* Connecting lines */}
        {nodes.map((n, i) => {
          const rad = (n.angle * Math.PI) / 180;
          const x = cx + radius * Math.cos(rad);
          const y = cy + radius * Math.sin(rad);
          const active = tick % nodes.length === i;
          return (
            <line key={`line-${i}`} x1={cx} y1={cy} x2={x} y2={y}
              stroke="url(#lineGradMV)"
              strokeWidth={active ? 2 : 0.8}
              opacity={active ? 0.9 : 0.2}
              className="transition-all duration-1000"
            />
          );
        })}

        {/* Central core */}
        <circle cx={cx} cy={cy} r="38" className="fill-surface stroke-accent" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="28" fill="none" style={{ stroke: viz(VIZ.emerald) }} strokeWidth="1" opacity="0.4" className="animate-spin-slow" strokeDasharray="6 6" />
        <circle cx={cx} cy={cy} r="18" style={{ fill: viz(VIZ.cyan) }} opacity="0.12" className="animate-pulse-slow" />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-accent" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="500">MEM</text>
        <text x={cx} y={cy + 9} textAnchor="middle" className="fill-positive" fontSize="7" fontFamily="JetBrains Mono, monospace">CORE</text>

        {/* Orbit nodes */}
        {nodes.map((n, i) => {
          const rad = (n.angle * Math.PI) / 180;
          const x = cx + radius * Math.cos(rad);
          const y = cy + radius * Math.sin(rad);
          const active = tick % nodes.length === i;
          return (
            <g key={`node-${i}`} className="transition-all duration-700">
              {active && <circle cx={x} cy={y} r="18" style={{ fill: viz(n.color) }} opacity="0.12" className="animate-pulse-slow" />}
              <circle cx={x} cy={y} r={active ? 11 : 7} style={{ stroke: viz(n.color) }} strokeWidth="2" opacity={active ? 1 : 0.55} className="fill-surface transition-all duration-700" />
              <circle cx={x} cy={y} r={active ? 5 : 3} style={{ fill: viz(n.color) }} opacity={active ? 0.9 : 0.4} className="transition-all duration-700" />
              <text x={x} y={y + 26} textAnchor="middle" className="fill-content-subtle" fontSize="9" fontFamily="JetBrains Mono, monospace">{n.label}</text>
            </g>
          );
        })}

        {/* Traveling particle */}
        {nodes.map((n, i) => {
          const rad = (n.angle * Math.PI) / 180;
          const x2 = cx + radius * Math.cos(rad);
          const y2 = cy + radius * Math.sin(rad);
          if (tick % nodes.length !== i) return null;
          return (
            <circle key={`particle-${i}`} r="3" className="fill-accent" opacity="0.9">
              <animateMotion dur="1.2s" repeatCount="indefinite"
                path={`M${x2},${y2} L${cx},${cy}`} />
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
