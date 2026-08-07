/**
 * Categorical palette for the diagrams and charts.
 *
 * These can't collapse into the semantic accent tokens — the whole point is that episodic,
 * semantic and procedural memories stay visually distinct. But they still have to be legible
 * against whichever surface they're drawn on, so each entry is a CSS variable that the theme
 * re-points (bright 400-weights on ink, 600-weights on white) rather than a fixed hex.
 *
 * The variables hold a bare `R G B` triple, matching the rest of the token system, so callers
 * can ask for a tint with `viz(VIZ.cyan, 0.12)` instead of splicing an alpha suffix onto a hex.
 */
export const VIZ = {
  cyan: 'var(--viz-cyan)',
  emerald: 'var(--viz-emerald)',
  violet: 'var(--viz-violet)',
  red: 'var(--viz-red)',
  amber: 'var(--viz-amber)',
} as const;

export type VizColor = (typeof VIZ)[keyof typeof VIZ];

/** Resolve a palette entry to a paintable colour, optionally at partial opacity. */
export function viz(color: string, alpha?: number): string {
  return alpha === undefined ? `rgb(${color})` : `rgb(${color} / ${alpha})`;
}
