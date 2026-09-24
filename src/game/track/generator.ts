import { Rng, seedToCode } from '../rng';
import {
  DESIGN_DIAMETER as D,
  INNER_LEFT,
  INNER_RIGHT,
  SAFE_GAP,
  SAFE_GAP_MOVING,
  SIDE_WALL,
  TRACK_WIDTH,
  marbleRadiusFor,
} from './constants';
import { CoverageMap } from './coverage';
import { clamp, deg, isMoving, itemGap, itemYRange, shapeGap, shapesOf, type Shape } from './geometry';
import type {
  BumperItem,
  PendulumItem,
  PegItem,
  ProgressModel,
  Ramp,
  Section,
  SectionType,
  SliderItem,
  SpinnerItem,
  Track,
  TrackItem,
  Vec,
  WallItem,
  WallStyle,
  ZoneItem,
} from './types';
import { validateTrack } from './validate';

/**
 * ---------------------------------------------------------------------------
 * RANDOM TRACK GENERATOR
 * ---------------------------------------------------------------------------
 * A course is a vertical stack of "sections" (peg field, zig-zag ramps,
 * spinners, a split path...). Each section is generated with random
 * parameters, but inside hand-written rules that keep it playable:
 *
 *  - every gap is wide enough for the biggest marble (see constants.ts),
 *  - ramps and funnel walls always slope downhill,
 *  - optional obstacles are only placed where they leave safe gaps,
 *  - moving parts get extra clearance so they can't pinch a marble,
 *  - a final validator re-checks the whole course; if anything is off,
 *    the course is thrown away and generated again.
 *
 * The generator also estimates how long each section takes, and keeps
 * adding sections until the course is about 20 seconds long.
 */

/** Target duration (in seconds of physics time) for a typical marble. */
export const TARGET_RACE_SECONDS = 14.4;

interface Flow {
  x: number;
  spread: number;
}

interface Region {
  xl: number;
  xr: number;
  y0: number;
  flow: Flow;
  lane: boolean;
  /** Ids of the walls on each side (deflectors attach to these). */
  leftWallId: number;
  rightWallId: number;
}

interface Built {
  type: SectionType;
  label: string;
  height: number;
  progress: ProgressModel;
  exit: Flow;
  /** Estimated seconds for a typical marble to get through. */
  estimate: number;
  weight: number;
  lanes?: Section['lanes'];
}

type LaneType = 'zigzag' | 'pegs' | 'bumpers' | 'spinners' | 'sliders' | 'pendulums' | 'cascade' | 'trampolines' | 'drop';

const LABELS: Record<SectionType, string[]> = {
  start: ['Starting Gate'],
  pegs: ['Peg Forest', 'Pachinko Rain', 'Plinko Plaza'],
  zigzag: ['Switchbacks', 'Zig-Zag Ramps', 'The Staircase'],
  mud: ['Mud Slide', 'Sticky Swamp', 'Slow Lane'],
  funnel: ['The Funnel', 'Bottleneck', 'Squeeze Point'],
  bumpers: ['Bumper Bash', 'Pinball Alley', 'Boing Zone'],
  spinners: ['Spin Cycle', 'Windmills', 'Paddle Wheels'],
  sliders: ['Sliding Doors', 'Shuttle Gates', 'Moving Walkway'],
  pendulums: ['Wrecking Balls', 'Swing Time', 'Pendulum Alley'],
  cascade: ['Waterfall', 'Cascade', 'Rapids'],
  trampolines: ['Trampoline Park', 'Boing Boards', 'Springboards'],
  drop: ['Free Fall', 'The Plunge', 'Cliff Drop'],
  split: ['The Split', 'Fork in the Road', 'Choose a Side'],
  finish: ['Final Funnel'],
};

const LANE_LABELS: Record<LaneType, string> = {
  zigzag: 'Ramps',
  pegs: 'Pegs',
  bumpers: 'Bumpers',
  spinners: 'Spinners',
  sliders: 'Shuttles',
  pendulums: 'Wrecking balls',
  cascade: 'Waterfall',
  trampolines: 'Trampolines',
  drop: 'Plunge',
};

// ---------------------------------------------------------------------------
// Builder: collects items and enforces safe gaps for optional obstacles.
// ---------------------------------------------------------------------------

class Builder {
  items: TrackItem[] = [];
  private idCounter = 1;
  leftWall!: WallItem;
  rightWall!: WallItem;

  constructor(
    readonly rng: Rng,
    readonly count: number,
    readonly radius: number,
  ) {}

  id(): number {
    return this.idCounter++;
  }

  // Spatial index: items bucketed by height so safety checks only look at
  // nearby obstacles (a course has several hundred of them).
  private static readonly BUCKET = 250;
  private buckets = new Map<number, TrackItem[]>();
  private tallItems: TrackItem[] = [];
  private yRanges = new Map<number, [number, number]>();
  private shapeCache = new Map<number, Shape[]>();
  private visitStamp = new Map<number, number>();
  private stamp = 0;

  private push(item: TrackItem) {
    this.items.push(item);
    if (item.kind === 'zone') return;
    const range = itemYRange(item);
    this.yRanges.set(item.id, range);
    this.shapeCache.set(item.id, shapesOf(item));
    if (range[1] - range[0] > 4000) {
      this.tallItems.push(item);
      return;
    }
    for (let k = Math.floor(range[0] / Builder.BUCKET); k <= Math.floor(range[1] / Builder.BUCKET); k++) {
      let list = this.buckets.get(k);
      if (!list) this.buckets.set(k, (list = []));
      list.push(item);
    }
  }

  private nearby(top: number, bottom: number): TrackItem[] {
    const out = this.tallItems.slice();
    const stamp = ++this.stamp;
    for (let k = Math.floor(top / Builder.BUCKET); k <= Math.floor(bottom / Builder.BUCKET); k++) {
      for (const item of this.buckets.get(k) ?? []) {
        if (this.visitStamp.get(item.id) === stamp) continue;
        this.visitStamp.set(item.id, stamp);
        out.push(item);
      }
    }
    return out;
  }

  private gapBetween(shapes: Shape[], other: TrackItem): number {
    let best = Infinity;
    for (const s1 of shapes) for (const s2 of this.shapeCache.get(other.id)!) best = Math.min(best, shapeGap(s1, s2));
    return best;
  }

  /** Takes an item back out (used when a station doesn't fit after all). */
  remove(item: TrackItem) {
    this.items = this.items.filter((i) => i !== item);
    this.tallItems = this.tallItems.filter((i) => i !== item);
    for (const list of this.buckets.values()) {
      const idx = list.indexOf(item);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  wall(a: Vec, b: Vec, thickness: number, style: WallStyle, optional = false): WallItem {
    const item: WallItem = { kind: 'wall', id: this.id(), a, b, thickness, style, optional };
    this.push(item);
    return item;
  }

  zone(polygon: Vec[], drag: number): ZoneItem {
    const item: ZoneItem = { kind: 'zone', id: this.id(), zone: 'mud', polygon, drag };
    this.push(item);
    return item;
  }

  /**
   * Adds an obstacle only if it keeps a safe gap to everything already
   * placed (except the items in `ignore`, e.g. the wall a deflector is
   * attached to). Returns false (and adds nothing) otherwise.
   */
  tryAdd(item: TrackItem, opts: { ignore?: number[]; minGap?: number } = {}): boolean {
    const [top, bottom] = itemYRange(item);
    const shapes = shapesOf(item);
    for (const other of this.nearby(top - 200, bottom + 200)) {
      if (opts.ignore?.includes(other.id)) continue;
      const [oTop, oBottom] = this.yRanges.get(other.id)!;
      if (oBottom < top - 200 || oTop > bottom + 200) continue;
      const required = Math.max(
        isMoving(item) || isMoving(other) ? SAFE_GAP_MOVING : SAFE_GAP,
        opts.minGap ?? 0,
      );
      if (this.gapBetween(shapes, other) < required) return false;
    }
    this.push(item);
    return true;
  }

  peg(x: number, y: number, r: number): PegItem {
    return { kind: 'peg', id: this.id(), x, y, r, optional: true };
  }

  bumper(x: number, y: number, r: number, restitution = 1.05): BumperItem {
    return { kind: 'bumper', id: this.id(), x, y, r, restitution, optional: true };
  }

  /** A short slanted wall sticking out of a side wall, pushing marbles inward. */
  deflector(region: Region, side: 'L' | 'R', y: number, length: number, angleDeg: number): boolean {
    const dx = Math.cos(deg(angleDeg)) * length;
    const dy = Math.sin(deg(angleDeg)) * length;
    const a = side === 'L' ? { x: region.xl - 2, y } : { x: region.xr + 2, y };
    const b = side === 'L' ? { x: region.xl + dx, y: y + dy } : { x: region.xr - dx, y: y + dy };
    const item: WallItem = { kind: 'wall', id: this.id(), a, b, thickness: 14, style: 'deflector', optional: true };
    const attachedTo = side === 'L' ? region.leftWallId : region.rightWallId;
    return this.tryAdd(item, { ignore: [attachedTo] });
  }

  /**
   * A half-round bump sticking out of a vertical wall (side wall or divider).
   * Marbles sliding down the wall get knocked back into play; nothing can
   * rest on it because it only ever pushes away from the wall.
   */
  wallBump(region: Region, side: 'L' | 'R', y: number, r: number): boolean {
    const wallX = side === 'L' ? region.xl : region.xr;
    const x = wallX + (side === 'L' ? -r * 0.25 : r * 0.25);
    const attachedTo = side === 'L' ? region.leftWallId : region.rightWallId;
    return this.tryAdd(this.peg(x, y, r), { ignore: [attachedTo] });
  }

  /**
   * Something sticking `reach` units out of a vertical wall at height y:
   * a round bump for short reaches, a slanted deflector for longer ones.
   */
  wallFiller(region: Region, side: 'L' | 'R', y: number, reach: number): boolean {
    if (!Number.isFinite(reach) || reach < 6) return false;
    if (reach <= 17) return this.wallBump(region, side, y, Math.max(8, reach / 0.75));
    const angle = 32;
    const length = reach / Math.cos(deg(angle));
    const dy = Math.sin(deg(angle)) * length;
    return this.deflector(region, side, y - dy / 2, length, angle);
  }

  /** A short slanted plate floating in open space. */
  plate(cx: number, cy: number, length: number, angleDeg: number, thickness = 12): WallItem {
    const dx = (Math.cos(deg(angleDeg)) * length) / 2;
    const dy = (Math.sin(deg(angleDeg)) * length) / 2;
    return {
      kind: 'wall',
      id: this.id(),
      a: { x: cx - dx, y: cy - dy },
      b: { x: cx + dx, y: cy + dy },
      thickness,
      style: 'plate',
      optional: true,
    };
  }

  /** Scatter a few small pegs in the free space of a section. */
  sprinklePegs(region: Region, y0: number, y1: number, count: number) {
    for (let i = 0, placed = 0; i < count * 8 && placed < count; i++) {
      const x = this.rng.range(region.xl + 30, region.xr - 30);
      const y = this.rng.range(y0, y1);
      if (this.tryAdd(this.peg(x, y, this.rng.range(6, 8.5)))) placed++;
    }
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function buildStart(b: Builder, y0: number) {
  const n = b.count;
  const r = b.radius;
  const spacingX = 2 * r + 12;
  const maxCols = Math.floor((INNER_RIGHT - INNER_LEFT - 80) / spacingX);
  const rows = Math.ceil(n / maxCols);
  const cols = Math.ceil(n / rows);
  const rowH = 2 * r + 4;
  const gateThickness = 16;
  const height = 110 + rows * rowH;
  const gateY = y0 + height;
  const cx = TRACK_WIDTH / 2;

  const slots: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const stagger = rows > 1 ? (row % 2 === 1 ? spacingX / 4 : -spacingX / 4) : 0;
    slots.push({
      x: cx + (col - (inRow - 1) / 2) * spacingX + stagger,
      y: gateY - gateThickness / 2 - r - 1 - row * rowH,
    });
  }
  // The start gate is two trapdoor halves that are removed at "GO!".
  const g1 = b.wall({ x: INNER_LEFT - 4, y: gateY }, { x: cx, y: gateY }, gateThickness, 'gate');
  const g2 = b.wall({ x: cx, y: gateY }, { x: INNER_RIGHT + 4, y: gateY }, gateThickness, 'gate');

  const built: Built = {
    type: 'start',
    label: LABELS.start[0],
    height: height + 20,
    progress: { kind: 'vertical' },
    exit: { x: cx, spread: (INNER_RIGHT - INNER_LEFT) / 2 },
    estimate: 0.2,
    weight: 60,
  };
  return { built, slots, gateIds: [g1.id, g2.id], gateY };
}

function sideForFlow(rng: Rng, region: Region): 'L' | 'R' {
  const mid = (region.xl + region.xr) / 2;
  const width = region.xr - region.xl;
  if (region.flow.spread < width * 0.35) return region.flow.x < mid ? 'L' : 'R';
  return rng.chance(0.5) ? 'L' : 'R';
}

interface ZigzagOptions {
  forcedHeight?: number;
  mud?: boolean;
}

function buildZigzag(b: Builder, region: Region, opts: ZigzagOptions = {}): Built {
  const { rng } = b;
  const width = region.xr - region.xl;
  const T = 18;
  const gap = rng.range(2.7, 3.2) * D;
  const L = width - gap;
  const minSlope = region.lane ? 12 : 11;
  const maxSlope = region.lane ? 19 : 16;
  const top = region.y0 + 46;

  // How many ramps fit (or how many we want).
  const avgRampDrop = L * Math.tan(deg((minSlope + maxSlope) / 2)) + 3 * D + T;
  let count: number;
  if (opts.forcedHeight !== undefined) {
    count = clamp(Math.floor((opts.forcedHeight - 90) / avgRampDrop), 1, 5);
  } else {
    count = region.lane ? rng.int(2, 3) : rng.int(2, 3);
  }

  let side = sideForFlow(rng, region);
  let y = top;
  const ramps: Ramp[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < count; i++) slopes.push(rng.range(minSlope, maxSlope));

  // Spread any leftover height (lanes) across the drops between ramps.
  let dropExtra = 0;
  if (opts.forcedHeight !== undefined) {
    const natural = slopes.reduce((s, a) => s + L * Math.tan(deg(a)), 0) + count * (2.8 * D + T) + 50;
    dropExtra = clamp((opts.forcedHeight - natural) / count, 0, 1.2 * D);
  }

  const mudRamp = opts.mud ? -1 : rng.chance(0.3) ? rng.int(0, count - 1) : -2;
  let totalLength = 0;
  let lastLowX = 0;

  for (let i = 0; i < count; i++) {
    const slope = deg(slopes[i]);
    const highX = side === 'L' ? region.xl - 2 : region.xr + 2;
    const lowX = side === 'L' ? region.xr - gap : region.xl + gap;
    const a = { x: highX, y };
    const bEnd = { x: lowX, y: y + Math.abs(lowX - highX) * Math.tan(slope) };
    ramps.push({ a, b: bEnd });
    totalLength += Math.hypot(bEnd.x - a.x, bEnd.y - a.y);

    const hasMud = opts.mud || mudRamp === i;
    const hasHole = !hasMud && !region.lane && width > 600 && rng.chance(0.35);

    if (hasHole) {
      // A gap in the middle of the ramp: fast marbles jump it, slow ones fall through.
      const t = rng.range(0.4, 0.62);
      const holeW = rng.range(2.5, 2.9) * D;
      const dir = Math.sign(bEnd.x - a.x);
      const hx1 = a.x + dir * (Math.abs(bEnd.x - a.x) * t - holeW / 2);
      const hx2 = hx1 + dir * holeW;
      const yAt = (x: number) => a.y + ((x - a.x) / (bEnd.x - a.x)) * (bEnd.y - a.y);
      b.wall(a, { x: hx1, y: yAt(hx1) }, T, 'ramp');
      b.wall({ x: hx2, y: yAt(hx2) }, bEnd, T, 'ramp');
    } else {
      b.wall(a, bEnd, T, 'ramp');
    }

    if (hasMud) {
      const t1 = opts.mud ? rng.range(0.12, 0.25) : rng.range(0.2, 0.45);
      const t2 = Math.min(0.92, t1 + (opts.mud ? rng.range(0.45, 0.6) : rng.range(0.3, 0.45)));
      const p1 = { x: a.x + (bEnd.x - a.x) * t1, y: a.y + (bEnd.y - a.y) * t1 };
      const p2 = { x: a.x + (bEnd.x - a.x) * t2, y: a.y + (bEnd.y - a.y) * t2 };
      const lift = T / 2 + 2.3 * D;
      b.zone(
        [
          { x: p1.x, y: p1.y - T / 2 },
          { x: p2.x, y: p2.y - T / 2 },
          { x: p2.x, y: p2.y - lift },
          { x: p1.x, y: p1.y - lift },
        ],
        0.028,
      );
    }

    lastLowX = lowX;
    y = bEnd.y + rng.range(2.6, 3.1) * D + T + dropExtra;
    side = side === 'L' ? 'R' : 'L';
  }

  const lastLowY = ramps[ramps.length - 1].b.y;
  const height = opts.forcedHeight ?? lastLowY + 2.6 * D + 30 - region.y0;
  const exitX = lastLowX < (region.xl + region.xr) / 2 ? region.xl + gap / 2 : region.xr - gap / 2;

  // Rough timing model (seconds): rolling time grows with ramp length.
  const estimate = ramps.reduce((s, r) => s + 0.5 + Math.abs(r.b.x - r.a.x) / 473, 0) * (opts.mud ? 1.21 : 1);

  return {
    type: opts.mud ? 'mud' : 'zigzag',
    label: rng.pick(LABELS[opts.mud ? 'mud' : 'zigzag']),
    height,
    progress: { kind: 'ramps', ramps },
    exit: { x: exitX, spread: gap / 2 },
    estimate,
    weight: totalLength * 0.8 + height * 0.2,
  };
}

function buildPegs(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const h = forcedHeight ?? rng.range(420, 580);
  const pegR = rng.range(6.5, 8.5);
  // Spacing chosen so two staggered rows cover every column: a marble can't
  // drop straight through the field, but there is always room to pass.
  const reach = pegR + b.radius;
  const colGap = Math.max(2 * pegR + SAFE_GAP + 4, rng.range(3.3, 3.75) * reach);
  const rowGap = rng.range(2.2, 2.6) * D;
  const shift = rng.range(0, colGap);
  const top = region.y0 + 60;
  const bottom = region.y0 + h - 45;
  let row = 0;
  for (let y = top; y <= bottom; y += rowGap, row++) {
    const start = region.xl + ((shift + ((row % 2) * colGap) / 2) % colGap);
    let firstEdge = Infinity; // free space between the left wall and this row's first peg
    let lastEdge = Infinity; // ...and between the last peg and the right wall
    for (let x = start; x < region.xr; x += colGap) {
      const item = rng.chance(0.07) ? b.bumper(x, y, 12, 1.0) : b.peg(x, y, pegR);
      if (!b.tryAdd(item)) continue;
      firstEdge = Math.min(firstEdge, x - item.r - region.xl);
      lastEdge = Math.min(lastEdge, region.xr - x - item.r);
    }
    // Fill the space next to each wall as far as the safety gap allows, so the
    // staggered rows cover each other and nothing slides down the edge.
    b.wallFiller(region, 'L', y, firstEdge - SAFE_GAP - 2);
    b.wallFiller(region, 'R', y, lastEdge - SAFE_GAP - 2);
  }
  return {
    type: 'pegs',
    label: rng.pick(LABELS.pegs),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 280,
    weight: h,
  };
}

function buildBumpers(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const h = forcedHeight ?? rng.range(420, 560);
  const target = region.lane ? rng.int(2, 4) : rng.int(4, 7);
  let placed = 0;
  for (let attempt = 0; attempt < 300 && placed < target; attempt++) {
    const R = rng.range(22, region.lane ? 32 : 40);
    const xMin = region.xl + R + 1.8 * D;
    const xMax = region.xr - R - 1.8 * D;
    if (xMax <= xMin) continue;
    const x = rng.range(xMin, xMax);
    const y = rng.range(region.y0 + R + 70, region.y0 + h - R - 50);
    if (b.tryAdd(b.bumper(x, y, R, rng.range(1.0, 1.12)), { minGap: 1.9 * D })) placed++;
  }
  b.sprinklePegs(region, region.y0 + 60, region.y0 + h - 40, region.lane ? 3 : rng.int(4, 8));
  for (let i = 0; i < 2; i++) {
    b.deflector(region, i === 0 ? 'L' : 'R', rng.range(region.y0 + 80, region.y0 + h - 100), rng.range(45, 70), 40);
  }
  return {
    type: 'bumpers',
    label: rng.pick(LABELS.bumpers),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 247,
    weight: h,
  };
}

type Mover = 'spinner' | 'slider' | 'pendulum';

/**
 * A "station": a full-width funnel shelf with one or two openings, and a
 * moving obstacle right under each opening. Every marble lands on the shelf,
 * drops through an opening and has to get past the spinner / shuttle /
 * wrecking ball below – nobody slips through untouched.
 * Returns the y where the station ends, or null if it didn't fit.
 */
function buildStation(
  b: Builder,
  region: Region,
  y0: number,
  mover: Mover,
  maxBottom: number,
  avoid: number[],
): { end: number; centers: number[] } | null {
  const { rng } = b;
  const W = region.xr - region.xl;
  const w = clamp(D * (3.4 + b.count / 16), 3.4 * D, 5 * D);
  // Openings never line up with the ones above, so no marble can drop
  // straight through two stations in a row.
  let openings = 1;
  let centers: number[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    openings = region.lane || W < 700 ? 1 : rng.chance(0.6) ? 2 : 1;
    centers =
      openings === 1
        ? [(region.xl + region.xr) / 2 + rng.range(-0.2, 0.2) * W]
        : [region.xl + W * rng.range(0.26, 0.32), region.xr - W * rng.range(0.26, 0.32)];
    if (centers.every((c) => avoid.every((a) => Math.abs(c - a) > w * 1.3))) break;
  }
  const slope = deg(rng.range(30, 34));
  const extent = Math.max(centers[0] - w / 2 - region.xl, region.xr - (centers[centers.length - 1] + w / 2));
  let H = Math.tan(slope) * extent;
  let rise = 0;
  if (openings === 2) {
    const inner = centers[1] - w / 2 - (centers[0] + w / 2);
    rise = Math.tan(deg(34)) * (inner / 2);
    H = Math.max(H, rise + 25);
  }
  const top = y0 + 30;
  const bottom = top + H;

  // Movers under each opening (sized to fit; shrunk if they don't).
  const movers: TrackItem[] = [];
  for (const c of centers) {
    // Horizontal room around the opening, keeping clear of walls and dividers.
    const room = Math.min(c - region.xl, region.xr - c) - SAFE_GAP_MOVING - 12;
    let item: TrackItem | null = null;
    for (let attempt = 0; attempt < 6 && !item; attempt++) {
      const shrink = 1 - attempt * 0.12;
      let candidate: TrackItem;
      if (mover === 'spinner') {
        const L = Math.min(rng.range(78, region.lane ? 100 : 118) * shrink, room - 8);
        candidate = {
          kind: 'spinner',
          id: b.id(),
          x: c,
          y: bottom + L + 7 + SAFE_GAP_MOVING + 18 + attempt * 6,
          armLength: L,
          armThickness: 14,
          arms: rng.pick([2, 3, 4] as const),
          speed: rng.sign() * rng.range(1.5, 2.6),
          phase: rng.range(0, Math.PI * 2),
        } satisfies SpinnerItem;
      } else if (mover === 'slider') {
        const angle = rng.sign() * deg(rng.range(12, 20));
        // Bar + travel must fit in the room available.
        const amplitude = Math.min(w * rng.range(0.55, 0.95) * shrink, room * 0.45);
        const length = Math.min(w * rng.range(1.25, 1.7), ((room - amplitude) * 2) / Math.cos(angle));
        candidate = {
          kind: 'slider',
          id: b.id(),
          x: c,
          y: bottom + SAFE_GAP_MOVING + 30 + (Math.abs(Math.sin(angle)) * length) / 2,
          length,
          thickness: 16,
          angle,
          amplitude,
          period: rng.range(1.8, 3),
          phase: rng.range(0, Math.PI * 2),
        } satisfies SliderItem;
      } else {
        const swing = deg(rng.range(42, 58) * shrink);
        const length = Math.min(rng.range(90, 125), (room - 24) / Math.sin(swing));
        candidate = {
          kind: 'pendulum',
          id: b.id(),
          pivotX: c,
          pivotY: bottom + 36 + attempt * 8,
          length,
          bobR: rng.range(18, 23),
          amplitude: swing,
          period: rng.range(1.6, 2.4),
          phase: rng.range(0, Math.PI * 2),
        } satisfies PendulumItem;
      }
      if (itemYRange(candidate)[1] + SAFE_GAP_MOVING + 10 > maxBottom) continue;
      // The shelf isn't placed yet, so check the mover against it separately.
      const shelfGap = Math.min(...shelfWalls().map((wall) => gapToWall(candidate, wall)));
      if (shelfGap < SAFE_GAP_MOVING) continue;
      if (b.tryAdd(candidate)) item = candidate;
    }
    if (!item) {
      for (const m of movers) b.remove(m);
      return null;
    }
    movers.push(item);
  }

  function shelfWalls(): [Vec, Vec, number][] {
    const T = 18;
    const walls: [Vec, Vec, number][] = [
      [{ x: region.xl - 6, y: top }, { x: centers[0] - w / 2, y: bottom }, T],
      [{ x: region.xr + 6, y: top }, { x: centers[centers.length - 1] + w / 2, y: bottom }, T],
    ];
    if (openings === 2) {
      const px = (centers[0] + w / 2 + centers[1] - w / 2) / 2;
      walls.push([{ x: centers[0] + w / 2, y: bottom }, { x: px, y: bottom - rise }, T]);
      walls.push([{ x: px, y: bottom - rise }, { x: centers[1] - w / 2, y: bottom }, T]);
    }
    return walls;
  }
  for (const [a, c, t] of shelfWalls()) b.wall(a, c, t, 'funnel');

  const moverBottom = Math.max(...movers.map((m) => itemYRange(m)[1]));
  return { end: moverBottom + SAFE_GAP_MOVING + 12, centers };
}

function gapToWall(item: TrackItem, [a, c, t]: [Vec, Vec, number]): number {
  const wall: WallItem = { kind: 'wall', id: -1, a, b: c, thickness: t, style: 'funnel' };
  return itemGap(item, wall);
}

const MOVER_SECTION: Record<Mover, SectionType> = { spinner: 'spinners', slider: 'sliders', pendulum: 'pendulums' };

function buildStations(b: Builder, region: Region, mover: Mover, forcedHeight?: number): Built {
  const { rng } = b;
  const wanted = forcedHeight !== undefined ? 3 : rng.int(1, 2);
  const limit = forcedHeight !== undefined ? region.y0 + forcedHeight - 20 : region.y0 + 2000;
  let y = region.y0;
  let stations = 0;
  let avoid = region.flow.spread < (region.xr - region.xl) * 0.3 ? [region.flow.x] : [];
  for (let i = 0; i < wanted; i++) {
    // A few layouts are tried before giving up on another station.
    let station: { end: number; centers: number[] } | null = null;
    for (let attempt = 0; attempt < 4 && !station; attempt++) station = buildStation(b, region, y, mover, limit, avoid);
    if (station === null) break;
    y = station.end;
    avoid = station.centers;
    stations++;
  }
  const type = MOVER_SECTION[mover];
  const height = forcedHeight ?? Math.max(y - region.y0 + 20, 200);
  if (stations === 0 && forcedHeight === undefined) {
    // Extremely unlikely; fall back to a peg field so the course stays complete.
    return buildPegs(b, region);
  }
  return {
    type,
    label: rng.pick(LABELS[type]),
    height,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: 0.45 + stations * 1.6,
    weight: height,
  };
}

/** Waterfall: a staggered wall of short slanted plates marbles tumble down. */
function buildCascade(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const h = forcedHeight ?? rng.range(400, 520);
  const colGap = rng.range(region.lane ? 150 : 170, region.lane ? 185 : 215);
  const rowGap = rng.range(88, 108);
  const length = rng.range(100, 135);
  const pattern = rng.pick(['alternate', 'rows', 'random'] as const);
  const shift = rng.range(0, colGap);
  let row = 0;
  for (let y = region.y0 + 60; y <= region.y0 + h - 60; y += rowGap, row++) {
    const start = region.xl + ((shift + ((row % 2) * colGap) / 2) % colGap);
    let col = 0;
    let firstEdge = Infinity;
    let lastEdge = Infinity;
    for (let x = start; x < region.xr; x += colGap, col++) {
      const sign =
        pattern === 'alternate' ? (col % 2 === 0 ? 1 : -1) : pattern === 'rows' ? (row % 2 === 0 ? 1 : -1) : rng.sign();
      const plate = b.plate(x, y, length * rng.range(0.9, 1.1), sign * rng.range(22, 30));
      if (!b.tryAdd(plate)) continue;
      const minX = Math.min(plate.a.x, plate.b.x) - plate.thickness / 2;
      const maxX = Math.max(plate.a.x, plate.b.x) + plate.thickness / 2;
      firstEdge = Math.min(firstEdge, minX - region.xl);
      lastEdge = Math.min(lastEdge, region.xr - maxX);
    }
    b.wallFiller(region, 'L', y, firstEdge - SAFE_GAP - 2);
    b.wallFiller(region, 'R', y, lastEdge - SAFE_GAP - 2);
  }
  return {
    type: 'cascade',
    label: rng.pick(LABELS.cascade),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 207,
    weight: h,
  };
}

/** Trampoline park: springy slanted bars that launch marbles around. */
function buildTrampolines(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const h = forcedHeight ?? rng.range(400, 520);
  const target = region.lane ? rng.int(2, 3) : rng.int(4, 5);
  let placed = 0;
  for (let attempt = 0; attempt < 300 && placed < target; attempt++) {
    const length = rng.range(region.lane ? 80 : 95, region.lane ? 115 : 145);
    const x = rng.range(region.xl + length / 2 + 50, region.xr - length / 2 - 50);
    const y = rng.range(region.y0 + 90, region.y0 + h - 70);
    const bar = b.plate(x, y, length, rng.sign() * rng.range(16, 28), 14);
    bar.style = 'trampoline';
    if (b.tryAdd(bar, { minGap: 1.7 * D })) placed++;
  }
  return {
    type: 'trampolines',
    label: rng.pick(LABELS.trampolines),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 190,
    weight: h,
  };
}

function buildDrop(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const width = region.xr - region.xl;
  const h = forcedHeight ?? rng.range(330, 450);
  let y = region.y0 + 50;
  let side: 'L' | 'R' = rng.chance(0.5) ? 'L' : 'R';
  while (y < region.y0 + h - 110) {
    const length = width * rng.range(region.lane ? 0.2 : 0.14, region.lane ? 0.36 : 0.28);
    b.deflector(region, side, y, length, rng.range(30, 42));
    y += rng.range(95, 135);
    side = side === 'L' ? 'R' : 'L';
  }
  b.sprinklePegs(region, region.y0 + 40, region.y0 + h - 40, region.lane ? 1 : rng.int(2, 4));
  return {
    type: 'drop',
    label: rng.pick(LABELS.drop),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: width / 2 },
    estimate: h / 255,
    weight: h,
  };
}

function funnelOpening(count: number, min: number, max: number, perMarble: number): number {
  return clamp(D * (min + count / perMarble), D * min, D * max);
}

function buildFunnel(b: Builder, region: Region): Built {
  const { rng } = b;
  const T = 18;
  const top = region.y0 + 24;
  const twin = rng.chance(0.35);
  const minWall = deg(30);

  if (!twin) {
    const w = funnelOpening(b.count, 3.8, 6.5, 14);
    const c = rng.range(region.xl + 200 + w / 2, region.xr - 200 - w / 2);
    const ext = Math.max(c - w / 2 - region.xl, region.xr - (c + w / 2));
    const h = Math.max(Math.tan(minWall) * ext, rng.range(220, 300));
    b.wall({ x: region.xl - 6, y: top }, { x: c - w / 2, y: top + h }, T, 'funnel');
    b.wall({ x: region.xr + 6, y: top }, { x: c + w / 2, y: top + h }, T, 'funnel');
    return {
      type: 'funnel',
      label: rng.pick(LABELS.funnel.slice(0, 2)),
      height: 24 + h + 90,
      progress: { kind: 'vertical' },
      exit: { x: c, spread: w / 2 },
      estimate: 0.65 + (24 + h) / 412,
      weight: h + 90,
    };
  }

  // Twin funnel: two drains separated by a pointed peak.
  const w = funnelOpening(b.count, 3.5, 5.2, 20);
  const c1 = rng.range(region.xl + 170 + w / 2, 430);
  const c2 = rng.range(570, region.xr - 170 - w / 2);
  const px = (c1 + c2) / 2 + rng.range(-30, 30);
  const ext = Math.max(c1 - w / 2 - region.xl, region.xr - (c2 + w / 2));
  const h = Math.max(Math.tan(minWall) * ext, rng.range(220, 290));
  const peakRise = Math.min(h - 50, Math.tan(deg(36)) * Math.max(px - (c1 + w / 2), c2 - w / 2 - px));
  const bottom = top + h;
  b.wall({ x: region.xl - 6, y: top }, { x: c1 - w / 2, y: bottom }, T, 'funnel');
  b.wall({ x: c1 + w / 2, y: bottom }, { x: px, y: bottom - peakRise }, T, 'funnel');
  b.wall({ x: px, y: bottom - peakRise }, { x: c2 - w / 2, y: bottom }, T, 'funnel');
  b.wall({ x: region.xr + 6, y: top }, { x: c2 + w / 2, y: bottom }, T, 'funnel');
  return {
    type: 'funnel',
    label: 'Double Drain',
    height: 24 + h + 90,
    progress: { kind: 'vertical' },
    exit: { x: (c1 + c2) / 2, spread: (c2 - c1) / 2 + w / 2 },
    estimate: 0.6 + (24 + h) / 412,
    weight: h + 90,
  };
}

function buildLane(b: Builder, type: LaneType, region: Region, h: number): Built {
  switch (type) {
    case 'zigzag':
      return buildZigzag(b, region, { forcedHeight: h });
    case 'pegs':
      return buildPegs(b, region, h);
    case 'bumpers':
      return buildBumpers(b, region, h);
    case 'spinners':
      return buildStations(b, region, 'spinner', h);
    case 'sliders':
      return buildStations(b, region, 'slider', h);
    case 'pendulums':
      return buildStations(b, region, 'pendulum', h);
    case 'cascade':
      return buildCascade(b, region, h);
    case 'trampolines':
      return buildTrampolines(b, region, h);
    case 'drop':
      return buildDrop(b, region, h);
  }
}

function buildSplit(b: Builder, region: Region): Built {
  const { rng } = b;
  const cx = rng.range(430, 570);
  const H = rng.range(620, 800);
  const roofTop = region.y0 + 60;
  const roofSpan = 52;
  const roofDrop = 58;
  const divider = b.wall({ x: cx, y: roofTop + 20 }, { x: cx, y: region.y0 + H }, 20, 'divider');
  b.wall({ x: cx - roofSpan, y: roofTop + roofDrop }, { x: cx, y: roofTop }, 16, 'divider');
  b.wall({ x: cx, y: roofTop }, { x: cx + roofSpan, y: roofTop + roofDrop }, 16, 'divider');

  const laneTop = region.y0 + 160;
  const laneH = H - 160;
  const types: LaneType[] = rng.shuffle([
    'zigzag',
    'pegs',
    'bumpers',
    'spinners',
    'sliders',
    'pendulums',
    'cascade',
    'trampolines',
  ] as LaneType[]);
  // Make one lane "busy" (ramps / spinners) more often than not, for contrast.
  const [leftType, rightType] = types;

  const leftRegion: Region = {
    xl: region.xl,
    xr: cx - 10,
    y0: laneTop,
    flow: { x: cx - 40, spread: 40 },
    lane: true,
    leftWallId: region.leftWallId,
    rightWallId: divider.id,
  };
  const rightRegion: Region = {
    xl: cx + 10,
    xr: region.xr,
    y0: laneTop,
    flow: { x: cx + 40, spread: 40 },
    lane: true,
    leftWallId: divider.id,
    rightWallId: region.rightWallId,
  };
  const left = buildLane(b, leftType, leftRegion, laneH);
  const right = buildLane(b, rightType, rightRegion, laneH);

  return {
    type: 'split',
    label: rng.pick(LABELS.split),
    height: H + 30,
    progress: { kind: 'split', splitY: laneTop, dividerX: cx, left: left.progress, right: right.progress },
    exit: { x: TRACK_WIDTH / 2, spread: (region.xr - region.xl) / 2 },
    estimate: 0.7 + (left.estimate + right.estimate) / 2,
    weight: H + (left.weight + right.weight) / 2,
    lanes: [
      { label: LANE_LABELS[leftType], xl: leftRegion.xl, xr: leftRegion.xr },
      { label: LANE_LABELS[rightType], xl: rightRegion.xl, xr: rightRegion.xr },
    ],
  };
}

function buildFinish(b: Builder, region: Region) {
  const { rng } = b;
  const w = funnelOpening(b.count, 4.4, 7.5, 12);
  const c = TRACK_WIDTH / 2 + rng.range(-90, 90);
  const top = region.y0 + 30;
  const ext = Math.max(c - w / 2 - region.xl, region.xr - (c + w / 2));
  const h = Math.max(Math.tan(deg(31)) * ext, 260);
  b.wall({ x: region.xl - 6, y: top }, { x: c - w / 2, y: top + h }, 18, 'funnel');
  b.wall({ x: region.xr + 6, y: top }, { x: c + w / 2, y: top + h }, 18, 'funnel');
  // Final gauntlet: a few bumpers inside the funnel, so nobody drops straight
  // through the middle to the finish line.
  const gauntletY = [top + h * 0.35, top + h * 0.65];
  for (const gy of gauntletY) {
    const spread = ((gy - top) / h) * w + (1 - (gy - top) / h) * (region.xr - region.xl) * 0.8;
    const count = gy === gauntletY[0] ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const gx = c + (i - (count - 1) / 2) * (spread / count) + rng.range(-12, 12);
      b.tryAdd(rng.chance(0.5) ? b.bumper(gx, gy, rng.range(13, 17), 1.05) : b.peg(gx, gy, rng.range(8, 10)));
    }
  }
  const finishY = top + h + 26;
  // Collection basin below the finish line.
  const basinY = finishY + 250;
  b.wall({ x: region.xl - 6, y: basinY }, { x: c, y: basinY + 34 }, 24, 'basin');
  b.wall({ x: c, y: basinY + 34 }, { x: region.xr + 6, y: basinY }, 24, 'basin');
  const built: Built = {
    type: 'finish',
    label: LABELS.finish[0],
    height: finishY - region.y0,
    progress: { kind: 'vertical' },
    exit: { x: c, spread: w / 2 },
    estimate: 0.6 + h / 513,
    weight: h,
  };
  return { built, finishY, finishX1: c - w / 2, finishX2: c + w / 2, bottom: basinY + 60 };
}

// ---------------------------------------------------------------------------
// Course assembly
// ---------------------------------------------------------------------------

type FillerType =
  | 'pegs'
  | 'zigzag'
  | 'mud'
  | 'bumpers'
  | 'spinners'
  | 'sliders'
  | 'pendulums'
  | 'cascade'
  | 'trampolines'
  | 'drop'
  | 'funnel'
  | 'split';

const AVERAGE_ESTIMATE: Record<FillerType, number> = {
  pegs: 1.8,
  zigzag: 4.0,
  mud: 4.5,
  bumpers: 2.0,
  spinners: 2.5,
  sliders: 2.5,
  pendulums: 2.5,
  cascade: 2.2,
  trampolines: 2.4,
  drop: 1.5,
  funnel: 1.3,
  split: 3.5,
};

function buildSection(b: Builder, type: FillerType, region: Region): Built {
  switch (type) {
    case 'pegs':
      return buildPegs(b, region);
    case 'zigzag':
      return buildZigzag(b, region);
    case 'mud':
      return buildZigzag(b, region, { mud: true });
    case 'bumpers':
      return buildBumpers(b, region);
    case 'spinners':
      return buildStations(b, region, 'spinner');
    case 'sliders':
      return buildStations(b, region, 'slider');
    case 'pendulums':
      return buildStations(b, region, 'pendulum');
    case 'cascade':
      return buildCascade(b, region);
    case 'trampolines':
      return buildTrampolines(b, region);
    case 'drop':
      return buildDrop(b, region);
    case 'funnel':
      return buildFunnel(b, region);
    case 'split':
      return buildSplit(b, region);
  }
}

function chooseNext(rng: Rng, prev: FillerType | 'start', pending: FillerType[], budgetLeft: number): FillerType {
  if (prev === 'split') return 'funnel'; // lanes merge back together
  const reserve = pending.reduce((s, t) => s + AVERAGE_ESTIMATE[t], 0);
  const usable = pending.filter((t) => t !== prev);
  if (usable.length > 0 && (budgetLeft - reserve < 1.5 || rng.chance(0.45))) {
    const pick = rng.pick(usable);
    pending.splice(pending.indexOf(pick), 1);
    return pick;
  }
  const spare = budgetLeft - reserve;
  // Long sections are only chosen while there is time left for them.
  const fits = (t: FillerType) => (AVERAGE_ESTIMATE[t] <= spare + 0.8 ? 1 : 0.05);
  const weights: { item: FillerType; weight: number }[] = [
    { item: 'pegs', weight: 1 * fits('pegs') },
    { item: 'zigzag', weight: 1.1 * fits('zigzag') },
    { item: 'mud', weight: 0.45 * fits('mud') },
    { item: 'bumpers', weight: 1 * fits('bumpers') },
    { item: 'spinners', weight: 1 * fits('spinners') },
    { item: 'sliders', weight: 0.8 * fits('sliders') },
    { item: 'pendulums', weight: 0.9 * fits('pendulums') },
    { item: 'cascade', weight: 1.3 * fits('cascade') },
    { item: 'trampolines', weight: 1.1 * fits('trampolines') },
    { item: 'drop', weight: 0.4 * fits('drop') },
    { item: 'funnel', weight: prev === 'funnel' ? 0 : 0.8 * fits('funnel') },
  ];
  return rng.weighted(weights.filter((w) => w.item !== prev));
}

function generateOnce(seed: number, marbleCount: number): Track {
  const rng = new Rng(seed);
  const radius = marbleRadiusFor(marbleCount);
  const b = new Builder(rng, marbleCount, radius);

  // Outer walls first (their bottom is fixed once we know the height).
  b.leftWall = b.wall({ x: SIDE_WALL / 2, y: -40 }, { x: SIDE_WALL / 2, y: 100_000 }, SIDE_WALL, 'wall');
  b.rightWall = b.wall(
    { x: TRACK_WIDTH - SIDE_WALL / 2, y: -40 },
    { x: TRACK_WIDTH - SIDE_WALL / 2, y: 100_000 },
    SIDE_WALL,
    'wall',
  );
  const ceiling = b.wall({ x: 0, y: -20 }, { x: TRACK_WIDTH, y: -20 }, 40, 'wall');

  const sections: Section[] = [];
  const push = (built: Built, y0: number) => {
    sections.push({
      type: built.type,
      label: built.label,
      y0,
      y1: y0 + built.height,
      progress: built.progress,
      weight: built.weight,
      estimate: built.estimate,
      lanes: built.lanes,
    });
  };

  const region = (y0: number, flow: Flow): Region => ({
    xl: INNER_LEFT,
    xr: INNER_RIGHT,
    y0,
    flow,
    lane: false,
    leftWallId: b.leftWall.id,
    rightWallId: b.rightWall.id,
  });

  const start = buildStart(b, 0);
  push(start.built, 0);
  let y = start.built.height;
  let flow = start.built.exit;
  let estimate = start.built.estimate;

  // The first section after the start gate must be wide (marbles fall in everywhere).
  const first = rng.pick(['pegs', 'bumpers', 'cascade', 'trampolines'] as const);
  let built = buildSection(b, first, region(y, flow));
  push(built, y);
  y += built.height;
  flow = built.exit;
  estimate += built.estimate;
  let prev: FillerType = first;

  const finishEstimate = 1.3;
  const pending: FillerType[] = rng.shuffle(['zigzag', 'split', rng.pick(['spinners', 'sliders', 'pendulums'] as FillerType[])]);
  for (let guard = 0; guard < 14; guard++) {
    const budgetLeft = TARGET_RACE_SECONDS - estimate - finishEstimate;
    if (pending.length === 0 && prev !== 'split' && budgetLeft < 0.45) break;
    const type = chooseNext(rng, prev, pending, budgetLeft);
    built = buildSection(b, type, region(y, flow));
    push(built, y);
    y += built.height;
    flow = built.exit;
    estimate += built.estimate;
    prev = type;
  }

  const finish = buildFinish(b, region(y, flow));
  push(finish.built, y);
  estimate += finish.built.estimate;

  // Plug any open shaft a lucky marble could fall straight down.
  plugOpenShafts(b, start.gateY + 20, finish.finishY - 10, start.gateIds);

  // The basin at the bottom of the finish section is the floor of the course.
  const height = finish.bottom;
  b.leftWall.b = { x: b.leftWall.b.x, y: height };
  b.rightWall.b = { x: b.rightWall.b.x, y: height };
  void ceiling;

  return {
    seed,
    code: seedToCode(seed),
    width: TRACK_WIDTH,
    height,
    innerLeft: INNER_LEFT,
    innerRight: INNER_RIGHT,
    items: b.items,
    sections,
    startSlots: start.slots,
    marbleRadius: radius,
    gateIds: start.gateIds,
    gateY: start.gateY,
    finishY: finish.finishY,
    finishX1: finish.finishX1,
    finishX2: finish.finishX2,
    estimatedSeconds: estimate,
  };
}

// ---------------------------------------------------------------------------
// Shaft plugging: no marble should fall far without hitting something.
// ---------------------------------------------------------------------------

/** Target: no straight drop longer than this anywhere on the course. */
export const MAX_OPEN_DROP = 180;

interface WallSurface {
  id: number;
  x: number;
  side: 'L' | 'R'; // which side of the open space the wall is on
  y0: number;
  y1: number;
}

function verticalSurfaces(items: readonly TrackItem[]): WallSurface[] {
  const out: WallSurface[] = [];
  for (const it of items) {
    if (it.kind !== 'wall' || Math.abs(it.a.x - it.b.x) > 1) continue;
    if (it.style !== 'wall' && it.style !== 'divider') continue;
    const y0 = Math.min(it.a.y, it.b.y);
    const y1 = Math.max(it.a.y, it.b.y);
    out.push({ id: it.id, x: it.a.x + it.thickness / 2, side: 'L', y0, y1 });
    out.push({ id: it.id, x: it.a.x - it.thickness / 2, side: 'R', y0, y1 });
  }
  return out;
}

function plugOpenShafts(b: Builder, yTop: number, yBottom: number, ignoreIds: number[]) {
  const { rng } = b;
  const r = b.radius;
  const surfaces = verticalSurfaces(b.items);
  const map = new CoverageMap(b.items, r, ignoreIds);
  const xl = INNER_LEFT + r + 1;
  const xr = INNER_RIGHT - r - 1;

  const nearestWall = (x: number, y: number, side: 'L' | 'R') => {
    let best: WallSurface | null = null;
    for (const s of surfaces) {
      if (s.side !== side || y < s.y0 + 10 || y + 80 > s.y1) continue;
      if (side === 'L' ? s.x > x : s.x < x) continue;
      if (!best || Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
    }
    return best;
  };

  const place = (x: number, top: number, bottom: number): TrackItem | null => {
    const lo = top + Math.min(70, (bottom - top) * 0.3);
    const hi = Math.min(bottom - 30, top + MAX_OPEN_DROP * 0.9);
    for (let attempt = 0; attempt < 9; attempt++) {
      const y = rng.range(lo, Math.max(lo + 1, hi));
      const left = nearestWall(x, y, 'L');
      const right = nearestWall(x, y, 'R');
      // A little extra room around fillers so marbles can't get cradled between them.
      const tryItem = (item: TrackItem, ignore: number[] = []) =>
        b.tryAdd(item, { ignore, minGap: 1.5 * D }) ? item : null;

      // Close to a wall: a bump on the wall, or a deflector sticking out of it.
      for (const wall of [left, right]) {
        if (!wall || Math.abs(x - wall.x) > 100) continue;
        for (const br of [18, 14, 10]) {
          if (Math.abs(x - wall.x) > br * 0.75 + r + 4) continue;
          const bump = b.peg(wall.x + (wall.side === 'L' ? -br * 0.25 : br * 0.25), y, br);
          const addedBump = tryItem(bump, [wall.id]);
          if (addedBump) return addedBump;
        }
        const length = Math.max(24, Math.abs(x - wall.x) - r + rng.range(8, 40));
        const angle = rng.range(28, 42);
        const dx = Math.cos(deg(angle)) * length;
        const dy = Math.sin(deg(angle)) * length;
        const dir = wall.side === 'L' ? 1 : -1;
        const item: WallItem = {
          kind: 'wall',
          id: b.id(),
          a: { x: wall.x - dir * 2, y },
          b: { x: wall.x + dir * dx, y: y + dy },
          thickness: 14,
          style: 'deflector',
          optional: true,
        };
        const added = tryItem(item, [wall.id]);
        if (added) return added;
      }

      // Open space: a peg, a slanted plate or a small bumper.
      const jx = x + rng.range(-10, 10);
      const roll = rng.next();
      const item =
        roll < 0.5
          ? b.peg(jx, y, rng.range(7, 9.5))
          : roll < 0.82
            ? b.plate(jx, y, rng.range(48, 70), rng.sign() * rng.range(24, 36))
            : b.bumper(jx, y, rng.range(13, 17), 1.02);
      const added = tryItem(item);
      if (added) return added;
    }
    return null;
  };

  // Spots where no obstacle fits safely (e.g. right next to a spinner).
  const hopeless = new Set<string>();
  const key = (x: number, top: number) => `${Math.round(x / 24)}:${Math.round(top / 40)}`;
  for (let pass = 0; pass < 4; pass++) {
    const gaps = map.longGaps(xl, xr, yTop, yBottom, MAX_OPEN_DROP, 9).sort((a, c) => c.length - a.length);
    let placedAny = false;
    for (const g of gaps) {
      // Walk down the shaft, plugging it every ~MAX_OPEN_DROP units.
      let cursor = g.top;
      for (let guard = 0; guard < 40 && cursor < g.bottom; guard++) {
        const open = map.gapsAt(g.x, cursor, g.bottom).find((x) => x.length > MAX_OPEN_DROP);
        if (!open) break;
        if (hopeless.has(key(g.x, open.top))) {
          cursor = open.top + MAX_OPEN_DROP * 0.5;
          continue;
        }
        const item = place(open.x, open.top, open.bottom);
        if (item) {
          map.add(item);
          placedAny = true;
          cursor = open.top;
        } else {
          hopeless.add(key(g.x, open.top));
          cursor = open.top + MAX_OPEN_DROP * 0.5;
        }
      }
    }
    if (!placedAny) return;
  }
}

export interface GenerateResult {
  track: Track;
  attempts: number;
}

/**
 * Generates a playable course. If the validator finds a problem, the course
 * is regenerated from a derived seed (this is rare).
 */
export function generateTrackWithInfo(seed: number, marbleCount: number): GenerateResult {
  let current = seed >>> 0;
  let last: Track | null = null;
  for (let attempt = 1; attempt <= 40; attempt++) {
    const track = generateOnce(current, marbleCount);
    if (validateTrack(track).ok) return { track, attempts: attempt };
    last = track;
    current = (Math.imul(current ^ 0x5bd1e995, 0x27d4eb2d) + attempt) >>> 0;
  }
  // Extremely unlikely; the physics still has anti-stuck rescue as a backup.
  return { track: last!, attempts: 40 };
}

export function generateTrack(seed: number, marbleCount: number): Track {
  return generateTrackWithInfo(seed, marbleCount).track;
}
