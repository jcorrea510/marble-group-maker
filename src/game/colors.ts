/**
 * Marble colors.
 *
 * The first 20 marbles each get a single, hand-picked bright color that is
 * easy to tell apart on a dark background (neighbouring entries are very
 * different, so small groups get maximum contrast). Beyond 20 people, marbles
 * become two-tone: a base color with a contrasting swirl. That keeps up to
 * 60 marbles visually unique.
 */
export const BASE_PALETTE = [
  '#ff4757', // red
  '#3fa7ff', // sky blue
  '#ffd32a', // yellow
  '#2ed573', // green
  '#a55eea', // purple
  '#ff8c2e', // orange
  '#ff6bcb', // pink
  '#1ee3cf', // aqua
  '#f5f6fa', // pearl
  '#b8e63c', // lime
  '#5f6bff', // indigo
  '#ffab91', // peach
  '#e1a13a', // amber
  '#cfa8ff', // lavender
  '#9ff5c9', // mint
  '#c0392b', // crimson
  '#a8dcff', // ice
  '#16a085', // teal
  '#ff9ec4', // rose
  '#9aa7b8', // silver
] as const;

export const MAX_COLOR_INDEX = BASE_PALETTE.length * 3;

export interface MarbleStyle {
  /** Main marble color. */
  base: string;
  /** Color of the swirl inside the glass. */
  swirl: string;
  /** True when the swirl is a different color (two-tone marble). */
  twoTone: boolean;
}

export function marbleStyle(colorIndex: number): MarbleStyle {
  const n = BASE_PALETTE.length;
  const i = ((colorIndex % MAX_COLOR_INDEX) + MAX_COLOR_INDEX) % MAX_COLOR_INDEX;
  const tier = Math.floor(i / n);
  const k = i % n;
  const base = BASE_PALETTE[k];
  if (tier === 0) return { base, swirl: mix(base, '#ffffff', 0.55), twoTone: false };
  // Offsets chosen so the swirl always contrasts with the base color.
  const offset = tier === 1 ? 7 : 12;
  return { base, swirl: BASE_PALETTE[(k + offset) % n], twoTone: true };
}

/** The lowest color index that is not already used. */
export function nextFreeColorIndex(used: Iterable<number>): number {
  const taken = new Set(used);
  for (let i = 0; i < MAX_COLOR_INDEX; i++) if (!taken.has(i)) return i;
  return taken.size % MAX_COLOR_INDEX;
}

/** Accent colors for the group cards on the results screen. */
export const GROUP_COLORS = [
  '#7c5cff',
  '#ff5c8a',
  '#22c3ee',
  '#ffb020',
  '#2ed573',
  '#ff7849',
  '#c56cf0',
  '#1ee3cf',
  '#f7d046',
  '#5f8bff',
] as const;

export function groupColor(groupIndex: number): string {
  return GROUP_COLORS[groupIndex % GROUP_COLORS.length];
}

// ---------------------------------------------------------------------------
// Small color helpers (hex strings only, which is all the app uses).
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix between two colors, t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white text, whichever reads better on `hex`. */
export function readableTextOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#0b0d1a' : '#ffffff';
}
