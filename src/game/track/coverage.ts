import { shapesOf, sliderEndpoints, type Shape } from './geometry';
import type { Track, TrackItem } from './types';

/**
 * "Coverage" = how far a marble could fall straight down without touching
 * anything. The course generator uses this to find open shafts (where one
 * lucky marble could drop through a whole section untouched) and plug them
 * with pegs, plates and deflectors.
 */

export interface ColumnGap {
  x: number;
  top: number;
  bottom: number;
  length: number;
}

interface Blocker {
  shapes: Shape[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class CoverageMap {
  private blockers: Blocker[] = [];

  constructor(
    items: readonly TrackItem[],
    private readonly marbleRadius: number,
    ignoreIds: readonly number[] = [],
  ) {
    for (const item of items) this.add(item, ignoreIds);
  }

  add(item: TrackItem, ignoreIds: readonly number[] = []) {
    if (item.kind === 'zone' || ignoreIds.includes(item.id)) return;
    const shapes = blockingShapes(item);
    if (shapes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      const pts = s.type === 'circle' ? [s.c] : [s.a, s.b];
      for (const p of pts) {
        minX = Math.min(minX, p.x - s.r);
        maxX = Math.max(maxX, p.x + s.r);
        minY = Math.min(minY, p.y - s.r);
        maxY = Math.max(maxY, p.y + s.r);
      }
    }
    const m = this.marbleRadius;
    this.blockers.push({ shapes, minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m });
  }

  /** y-intervals where a marble centred on `x` would touch something. */
  intervalsAt(x: number, yTop: number, yBottom: number): [number, number][] {
    const r = this.marbleRadius;
    const out: [number, number][] = [];
    for (const b of this.blockers) {
      if (x < b.minX || x > b.maxX || b.maxY < yTop || b.minY > yBottom) continue;
      for (const s of b.shapes) {
        if (s.type === 'circle') {
          const w = s.r + r;
          const dx = Math.abs(s.c.x - x);
          if (dx > w) continue;
          const h = Math.sqrt(w * w - dx * dx);
          if (s.c.y + h >= yTop && s.c.y - h <= yBottom) out.push([s.c.y - h, s.c.y + h]);
        } else {
          const w = s.r + r;
          const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
          const n = Math.max(1, Math.ceil(len / 5));
          for (let i = 0; i <= n; i++) {
            const px = s.a.x + ((s.b.x - s.a.x) * i) / n;
            const py = s.a.y + ((s.b.y - s.a.y) * i) / n;
            const dx = Math.abs(px - x);
            if (dx > w) continue;
            const h = Math.sqrt(w * w - dx * dx);
            if (py + h >= yTop && py - h <= yBottom) out.push([py - h, py + h]);
          }
        }
      }
    }
    return out;
  }

  /** Open vertical runs at `x` between yTop and yBottom. */
  gapsAt(x: number, yTop: number, yBottom: number): ColumnGap[] {
    const intervals = this.intervalsAt(x, yTop, yBottom).sort((a, b) => a[0] - b[0]);
    const gaps: ColumnGap[] = [];
    let cursor = yTop;
    for (const [s, e] of intervals) {
      if (s > cursor) gaps.push({ x, top: cursor, bottom: s, length: s - cursor });
      cursor = Math.max(cursor, e);
      if (cursor >= yBottom) break;
    }
    if (cursor < yBottom) gaps.push({ x, top: cursor, bottom: yBottom, length: yBottom - cursor });
    return gaps;
  }

  /** Every open run longer than `maxGap`, scanning columns `step` apart. */
  longGaps(xl: number, xr: number, yTop: number, yBottom: number, maxGap: number, step = 6): ColumnGap[] {
    const result: ColumnGap[] = [];
    for (let x = xl; x <= xr; x += step) {
      for (const g of this.gapsAt(x, yTop, yBottom)) if (g.length > maxGap) result.push(g);
    }
    return result;
  }
}

/**
 * What a falling marble is guaranteed to hit. Moving parts only count where
 * they are always present: a spinner's hub, and the stretch a sliding bar
 * covers at every point of its travel. (A marble can slip past the rest.)
 */
function blockingShapes(item: TrackItem): Shape[] {
  if (item.kind === 'spinner') return [{ type: 'circle', c: { x: item.x, y: item.y }, r: item.armThickness }];
  if (item.kind === 'pendulum') return [];
  if (item.kind === 'slider') {
    const [a1, b1] = sliderEndpoints(item, -item.amplitude);
    const [a2] = sliderEndpoints(item, item.amplitude);
    // Always-covered part: from the left end at the far-right position to the
    // right end at the far-left position (empty if the bar is short).
    if (a2.x >= b1.x) return [];
    const t0 = (a2.x - a1.x) / (b1.x - a1.x);
    const y0 = a1.y + (b1.y - a1.y) * t0;
    return [{ type: 'capsule', a: { x: a2.x, y: y0 }, b: { x: b1.x, y: b1.y }, r: item.thickness / 2 }];
  }
  return shapesOf(item);
}

/** Longest straight drop anywhere between the start gate and the finish line. */
export function longestOpenDrop(track: Track): ColumnGap | null {
  const map = new CoverageMap(track.items, track.marbleRadius, track.gateIds);
  const r = track.marbleRadius;
  let best: ColumnGap | null = null;
  const yTop = track.gateY + 20;
  const yBottom = track.finishY - 10;
  for (let x = track.innerLeft + r + 1; x <= track.innerRight - r - 1; x += 6) {
    for (const g of map.gapsAt(x, yTop, yBottom)) if (!best || g.length > best.length) best = g;
  }
  return best;
}
