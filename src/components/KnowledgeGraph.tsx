export default function KnowledgeGraph({ className = '' }: { className?: string }) {
  const nodes = [
    { x: 200, y: 55,  r: 14, label: 'User',    color: '#22d3ee' },
    { x: 80,  y: 145, r: 10, label: 'Pref',    color: '#34d399' },
    { x: 320, y: 145, r: 10, label: 'History', color: '#34d399' },
    { x: 130, y: 245, r: 12, label: 'Context', color: '#22d3ee' },
    { x: 270, y: 245, r: 12, label: 'Task',    color: '#22d3ee' },
    { x: 200, y: 340, r: 10, label: 'Memory',  color: '#34d399' },
    { x: 60,  y: 315, r:  8, label: 'Tag',     color: '#34d399' },
    { x: 340, y: 315, r:  8, label: 'Meta',    color: '#34d399' },
  ];
  const edges: [number, number][] = [
    [0,1],[0,2],[0,3],[0,4],[1,3],[2,4],[3,5],[4,5],[3,6],[4,7],[5,6],[5,7]
  ];
  return (
    <svg viewBox="0 0 400 400" className={`w-full h-full ${className}`}>
      <defs>
        <linearGradient id="kgLine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {edges.map(([a,b],i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="url(#kgLine)" strokeWidth="1.5" strokeDasharray="4 4"
          className="animate-pulse-slow" style={{ animationDelay: `${i * 0.25}s` }} />
      ))}
      {nodes.map((n,i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r={n.r+6} fill={n.color} opacity="0.08" className="animate-pulse-slow" style={{ animationDelay: `${i * 0.2}s` }} />
          <circle cx={n.x} cy={n.y} r={n.r} fill="#0a1020" stroke={n.color} strokeWidth="2" />
          <text x={n.x} y={n.y+3} textAnchor="middle" fill="#a8b6cd" fontSize="8" fontFamily="JetBrains Mono, monospace">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}
