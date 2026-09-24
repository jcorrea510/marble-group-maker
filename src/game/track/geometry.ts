import type { PendulumItem, SliderItem, SpinnerItem, TrackItem, Vec } from './types';

export const deg = (d: number) => (d * Math.PI) / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const cross = (o: Vec, p: Vec, q: Vec) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Shortest distance between segments ab and cd. */
export function segmentSegmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

/** y of the (infinite) line through a ramp at a given x. */
export function lineYAt(a: Vec, b: Vec, x: number): number {
  if (Math.abs(b.x - a.x) < 1e-6) return Math.min(a.y, b.y);
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

/** Fraction (0..1) of the projection of x onto the horizontal extent a→b. */
export function fractionAlong(a: Vec, b: Vec, x: number): number {
  if (Math.abs(b.x - a.x) < 1e-6) return 0;
  return clamp((x - a.x) / (b.x - a.x), 0, 1);
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A simplified "collision shape" of a track item used for clearance checks:
 * either a capsule (segment + radius) or a circle. Moving items are
 * represented by the whole area they sweep through.
 */
export type Shape =
  | { type: 'capsule'; a: Vec; b: Vec; r: number }
  | { type: 'circle'; c: Vec; r: number };

export function sliderEndpoints(s: SliderItem, offset: number): [Vec, Vec] {
  const hx = (Math.cos(s.angle) * s.length) / 2;
  const hy = (Math.sin(s.angle) * s.length) / 2;
  return [
    { x: s.x + offset - hx, y: s.y - hy },
    { x: s.x + offset + hx, y: s.y + hy },
  ];
}

/** Sample positions of a pendulum's ball across its whole swing. */
export function pendulumSweep(p: PendulumItem): Vec[] {
  const out: Vec[] = [];
  const steps = Math.max(4, Math.ceil((p.amplitude * 2) / ((5 * Math.PI) / 180)));
  for (let i = 0; i <= steps; i++) {
    const a = -p.amplitude + (2 * p.amplitude * i) / steps;
    out.push({ x: p.pivotX + Math.sin(a) * p.length, y: p.pivotY + Math.cos(a) * p.length });
  }
  return out;
}

export function spinnerReach(s: SpinnerItem): number {
  return s.armLength + s.armThickness / 2;
}

export function shapesOf(item: TrackItem): Shape[] {
  switch (item.kind) {
    case 'wall':
      return [{ type: 'capsule', a: item.a, b: item.b, r: item.thickness / 2 }];
    case 'peg':
    case 'bumper':
      return [{ type: 'circle', c: { x: item.x, y: item.y }, r: item.r }];
    case 'spinner':
      return [{ type: 'circle', c: { x: item.x, y: item.y }, r: spinnerReach(item) }];
    case 'slider': {
      // Approximate the swept area with the bar at both extremes + the middle.
      const shapes: Shape[] = [];
      for (const o of [-item.amplitude, 0, item.amplitude]) {
        const [a, b] = sliderEndpoints(item, o);
        shapes.push({ type: 'capsule', a, b, r: item.thickness / 2 });
      }
      // Plus the horizontal band the ends travel through.
      const [l0] = sliderEndpoints(item, -item.amplitude);
      const [l1] = sliderEndpoints(item, item.amplitude);
      const [, r0] = sliderEndpoints(item, -item.amplitude);
      const [, r1] = sliderEndpoints(item, item.amplitude);
      shapes.push({ type: 'capsule', a: l0, b: l1, r: item.thickness / 2 });
      shapes.push({ type: 'capsule', a: r0, b: r1, r: item.thickness / 2 });
      return shapes;
    }
    case 'pendulum':
      return pendulumSweep(item).map((c) => ({ type: 'circle' as const, c, r: item.bobR }));
    case 'zone':
      return [];
  }
}

/** Surface-to-surface gap between two shapes (negative/zero = touching). */
export function shapeGap(s1: Shape, s2: Shape): number {
  if (s1.type === 'circle' && s2.type === 'circle') return dist(s1.c, s2.c) - s1.r - s2.r;
  if (s1.type === 'circle' && s2.type === 'capsule')
    return pointSegmentDistance(s1.c, s2.a, s2.b) - s1.r - s2.r;
  if (s1.type === 'capsule' && s2.type === 'circle')
    return pointSegmentDistance(s2.c, s1.a, s1.b) - s1.r - s2.r;
  const c1 = s1 as Extract<Shape, { type: 'capsule' }>;
  const c2 = s2 as Extract<Shape, { type: 'capsule' }>;
  return segmentSegmentDistance(c1.a, c1.b, c2.a, c2.b) - c1.r - c2.r;
}

export function itemGap(a: TrackItem, b: TrackItem): number {
  let best = Infinity;
  for (const s1 of shapesOf(a)) for (const s2 of shapesOf(b)) best = Math.min(best, shapeGap(s1, s2));
  return best;
}

export function isMoving(item: TrackItem): boolean {
  return item.kind === 'spinner' || item.kind === 'slider' || item.kind === 'pendulum';
}

/** Vertical extent of an item (for quick culling). */
export function itemYRange(item: TrackItem): [number, number] {
  switch (item.kind) {
    case 'wall': {
      const r = item.thickness / 2;
      return [Math.min(item.a.y, item.b.y) - r, Math.max(item.a.y, item.b.y) + r];
    }
    case 'peg':
    case 'bumper':
      return [item.y - item.r, item.y + item.r];
    case 'spinner': {
      const reach = spinnerReach(item);
      return [item.y - reach, item.y + reach];
    }
    case 'slider': {
      const half = (Math.abs(Math.sin(item.angle)) * item.length) / 2 + item.thickness;
      return [item.y - half, item.y + half];
    }
    case 'pendulum': {
      const ys = pendulumSweep(item).map((p) => p.y);
      return [Math.min(...ys) - item.bobR, Math.max(...ys) + item.bobR];
    }
    case 'zone': {
      const ys = item.polygon.map((p) => p.y);
      return [Math.min(...ys), Math.max(...ys)];
    }
  }
}
