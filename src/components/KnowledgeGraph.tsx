import { useEffect, useMemo, useState } from 'react';
import type { GraphEdge, GraphNode } from '../lib/api';
import { VIZ, viz } from '../lib/viz';

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  className?: string;
  onSelect?: (node: GraphNode) => void;
}

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
}

const WIDTH = 400;
const HEIGHT = 400;

const KIND_COLOR: Record<string, string> = {
  episodic: VIZ.cyan,
  semantic: VIZ.emerald,
  procedural: VIZ.violet,
};

const RELATION_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  supersedes: { stroke: VIZ.red, width: 1.8 },
  derived_from: { stroke: VIZ.emerald, width: 1.6 },
  similar_to: { stroke: VIZ.cyan, dash: '3 4', width: 1 },
};

/**
 * Force-directed layout, run to convergence once per data change.
 *
 * Hand-rolled rather than pulling in d3-force: the graph is capped at a few dozen nodes, so a
 * fixed-iteration simulation is imperceptible, and it keeps the bundle free of a dependency used in
 * exactly one component.
 */
function layout(nodes: GraphNode[], edges: GraphEdge[]): Placed[] {
  if (nodes.length === 0) return [];

  const index = new Map(nodes.map((n, i) => [n.id, i]));

  // Seed on a circle rather than at random: a deterministic start means the graph doesn't reshuffle
  // on every re-render, which is disorienting to watch.
  const positions = nodes.map((_, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    return {
      x: WIDTH / 2 + Math.cos(angle) * (WIDTH / 3),
      y: HEIGHT / 2 + Math.sin(angle) * (HEIGHT / 3),
    };
  });

  const links = edges
    .map((e) => ({ source: index.get(e.src_id), target: index.get(e.dst_id) }))
    .filter((l): l is { source: number; target: number } => l.source !== undefined && l.target !== undefined);

  const ITERATIONS = 220;
  const REPULSION = 5200;
  const SPRING = 0.012;
  const IDEAL_EDGE = 74;

  for (let step = 0; step < ITERATIONS; step++) {
    // Cooling schedule — large corrections early, fine adjustments late.
    const cooling = 1 - step / ITERATIONS;
    const forces = positions.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        let dx = positions[i].x - positions[j].x;
        let dy = positions[i].y - positions[j].y;
        let distanceSq = dx * dx + dy * dy;

        // Two nodes at the exact same point produce a zero-length vector and NaN coordinates;
        // nudge them apart deterministically instead.
        if (distanceSq < 0.01) {
          dx = (i - j) * 0.1 || 0.1;
          dy = 0.1;
          distanceSq = dx * dx + dy * dy;
        }

        const distance = Math.sqrt(distanceSq);
        const push = REPULSION / distanceSq;
        forces[i].x += (dx / distance) * push;
        forces[i].y += (dy / distance) * push;
        forces[j].x -= (dx / distance) * push;
        forces[j].y -= (dy / distance) * push;
      }
    }

    for (const { source, target } of links) {
      const dx = positions[target].x - positions[source].x;
      const dy = positions[target].y - positions[source].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - IDEAL_EDGE) * SPRING;

      forces[source].x += (dx / distance) * pull * distance;
      forces[source].y += (dy / distance) * pull * distance;
      forces[target].x -= (dx / distance) * pull * distance;
      forces[target].y -= (dy / distance) * pull * distance;
    }

    for (let i = 0; i < positions.length; i++) {
      // Gentle pull to centre keeps disconnected components from drifting off-canvas.
      forces[i].x += (WIDTH / 2 - positions[i].x) * 0.012;
      forces[i].y += (HEIGHT / 2 - positions[i].y) * 0.012;

      const step = 0.34 * cooling;
      positions[i].x += Math.max(-14, Math.min(14, forces[i].x * step));
      positions[i].y += Math.max(-14, Math.min(14, forces[i].y * step));

      const margin = 26;
      positions[i].x = Math.max(margin, Math.min(WIDTH - margin, positions[i].x));
      positions[i].y = Math.max(margin, Math.min(HEIGHT - margin, positions[i].y));
    }
  }

  return nodes.map((node, i) => ({ node, x: positions[i].x, y: positions[i].y }));
}

export default function KnowledgeGraph({ nodes, edges, className = '', onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Recompute only when the graph's shape changes, not on every parent render — the simulation is
  // cheap but not free, and re-running it would make nodes visibly jump.
  const signature = useMemo(
    () => `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => `${e.src_id}>${e.dst_id}`).join(',')}`,
    [nodes, edges],
  );

  const [placed, setPlaced] = useState<Placed[]>([]);
  useEffect(() => {
    setPlaced(layout(nodes, edges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  if (nodes.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-content-subtle ${className}`}>
        No memories to graph yet.
      </div>
    );
  }

  const hoveredNode = hovered ? byId.get(hovered)?.node : null;

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-full">
        <defs>
          <marker id="kgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: viz(VIZ.red) }} opacity="0.7" />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const source = byId.get(edge.src_id);
          const target = byId.get(edge.dst_id);
          if (!source || !target) return null;

          const style = RELATION_STYLE[edge.relation] ?? RELATION_STYLE.similar_to;
          const active = hovered === edge.src_id || hovered === edge.dst_id;

          return (
            <line
              key={`${edge.src_id}-${edge.dst_id}-${edge.relation}-${i}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              style={{ stroke: viz(style.stroke) }}
              strokeWidth={active ? style.width + 0.8 : style.width}
              strokeDasharray={style.dash}
              strokeOpacity={hovered && !active ? 0.12 : 0.5}
              markerEnd={edge.relation === 'supersedes' ? 'url(#kgArrow)' : undefined}
            />
          );
        })}

        {placed.map(({ node, x, y }) => {
          const color = KIND_COLOR[node.kind] ?? VIZ.cyan;
          const historical = node.status !== 'live';
          const radius = 7 + Number(node.importance) * 7;
          const dimmed = hovered !== null && hovered !== node.id;

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect?.(node)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
              opacity={dimmed ? 0.35 : 1}
            >
              <circle cx={x} cy={y} r={radius + 6} style={{ fill: viz(color) }} opacity={historical ? 0.04 : 0.1} />
              <circle
                cx={x}
                cy={y}
                r={radius}
                className="fill-surface"
                style={{ stroke: viz(color) }}
                strokeWidth={historical ? 1 : 2}
                strokeDasharray={historical ? '2 2' : undefined}
                strokeOpacity={historical ? 0.55 : 1}
              />
              {node.shared && (
                <circle cx={x + radius - 1} cy={y - radius + 1} r="2.5" style={{ fill: viz(VIZ.amber) }} />
              )}
            </g>
          );
        })}
      </svg>

      {hoveredNode && (
        <div className="absolute left-2 right-2 bottom-2 glass rounded-lg px-3 py-2 pointer-events-none">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: viz(KIND_COLOR[hoveredNode.kind] ?? VIZ.cyan) }}
            />
            <span className="text-[10px] font-mono text-content-subtle">{hoveredNode.kind}</span>
            {hoveredNode.status !== 'live' && (
              <span className="text-[10px] font-mono text-warning">{hoveredNode.status}</span>
            )}
            {hoveredNode.shared && <span className="text-[10px] font-mono text-warning">shared</span>}
          </div>
          <p className="text-xs text-content leading-snug line-clamp-3">{hoveredNode.content}</p>
        </div>
      )}
    </div>
  );
}

/** Legend, exported so the dashboard can place it outside the SVG's aspect box. */
export function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-subtle">
      {Object.entries(KIND_COLOR).map(([kind, color]) => (
        <span key={kind} className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: viz(color) }} />
          {kind}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-3 h-px" style={{ backgroundColor: viz(VIZ.red) }} /> supersedes
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-3 h-px bg-positive" /> derived from
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: viz(VIZ.cyan) }} /> similar
      </span>
    </div>
  );
}
