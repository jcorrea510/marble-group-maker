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
import { clamp, deg, isMoving, itemGap, itemYRange } from './geometry';
import type {
  BumperItem,
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
export const TARGET_RACE_SECONDS = 15.8;

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

type LaneType = 'zigzag' | 'pegs' | 'bumpers' | 'spinners' | 'sliders' | 'drop';

const LABELS: Record<SectionType, string[]> = {
  start: ['Starting Gate'],
  pegs: ['Peg Forest', 'Pachinko Rain', 'Plinko Plaza'],
  zigzag: ['Switchbacks', 'Zig-Zag Ramps', 'The Staircase'],
  mud: ['Mud Slide', 'Sticky Swamp', 'Slow Lane'],
  funnel: ['The Funnel', 'Bottleneck', 'Squeeze Point'],
  bumpers: ['Bumper Bash', 'Pinball Alley', 'Boing Zone'],
  spinners: ['Spin Cycle', 'Windmills', 'Paddle Wheels'],
  sliders: ['Shuttle Bars', 'Sliding Doors', 'Moving Walkway'],
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

  wall(a: Vec, b: Vec, thickness: number, style: WallStyle, optional = false): WallItem {
    const item: WallItem = { kind: 'wall', id: this.id(), a, b, thickness, style, optional };
    this.items.push(item);
    return item;
  }

  zone(polygon: Vec[], drag: number): ZoneItem {
    const item: ZoneItem = { kind: 'zone', id: this.id(), zone: 'mud', polygon, drag };
    this.items.push(item);
    return item;
  }

  /**
   * Adds an obstacle only if it keeps a safe gap to everything already
   * placed (except the items in `ignore`, e.g. the wall a deflector is
   * attached to). Returns false (and adds nothing) otherwise.
   */
  tryAdd(item: TrackItem, opts: { ignore?: number[]; minGap?: number } = {}): boolean {
    const [top, bottom] = itemYRange(item);
    for (const other of this.items) {
      if (other.kind === 'zone') continue;
      if (opts.ignore?.includes(other.id)) continue;
      const [oTop, oBottom] = itemYRange(other);
      if (oBottom < top - 200 || oTop > bottom + 200) continue;
      const required = Math.max(
        isMoving(item) || isMoving(other) ? SAFE_GAP_MOVING : SAFE_GAP,
        opts.minGap ?? 0,
      );
      if (itemGap(item, other) < required) return false;
    }
    this.items.push(item);
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
  const estimate = ramps.reduce((s, r) => s + 0.39 + Math.abs(r.b.x - r.a.x) / 605, 0) * (opts.mud ? 1.55 : 1);

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
  const colGap = rng.range(3.2, 3.9) * D;
  const rowGap = rng.range(2.3, 2.8) * D;
  const pegR = rng.range(6, 8.5);
  const shift = rng.range(0, colGap);
  const top = region.y0 + 60;
  const bottom = region.y0 + h - 45;
  let row = 0;
  for (let y = top; y <= bottom; y += rowGap, row++) {
    const start = region.xl + ((shift + ((row % 2) * colGap) / 2) % colGap);
    for (let x = start; x < region.xr; x += colGap) {
      if (rng.chance(0.1)) continue;
      const item = rng.chance(0.07) ? b.bumper(x, y, 12, 1.0) : b.peg(x, y, pegR);
      b.tryAdd(item);
    }
    if (row % 2 === 1 && rng.chance(0.55)) {
      b.deflector(region, rng.chance(0.5) ? 'L' : 'R', y + rowGap * 0.3, rng.range(40, 60), rng.range(35, 45));
    }
  }
  return {
    type: 'pegs',
    label: rng.pick(LABELS.pegs),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 495,
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
    estimate: h / 475,
    weight: h,
  };
}

function buildSpinners(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const h = forcedHeight ?? rng.range(440, 580);
  const target = region.lane ? rng.int(1, 2) : rng.int(2, 3);
  let placed = 0;
  for (let attempt = 0; attempt < 300 && placed < target; attempt++) {
    const armLength = rng.range(region.lane ? 65 : 85, region.lane ? 105 : 145);
    const xMin = region.xl + armLength + 2 * D;
    const xMax = region.xr - armLength - 2 * D;
    const yMin = region.y0 + armLength + 60;
    const yMax = region.y0 + h - armLength - 40;
    if (xMax <= xMin || yMax <= yMin) continue;
    const spinner: SpinnerItem = {
      kind: 'spinner',
      id: b.id(),
      x: rng.range(xMin, xMax),
      y: rng.range(yMin, yMax),
      armLength,
      armThickness: 14,
      arms: rng.pick([2, 3, 4] as const),
      speed: rng.sign() * rng.range(1.4, 2.6),
      phase: rng.range(0, Math.PI * 2),
    };
    if (b.tryAdd(spinner)) placed++;
  }
  b.sprinklePegs(region, region.y0 + 50, region.y0 + h - 40, region.lane ? 2 : rng.int(3, 7));
  b.deflector(region, rng.chance(0.5) ? 'L' : 'R', region.y0 + h * rng.range(0.3, 0.7), 50, 40);
  return {
    type: 'spinners',
    label: rng.pick(LABELS.spinners),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: (region.xr - region.xl) / 2 },
    estimate: h / 900,
    weight: h,
  };
}

function buildSliders(b: Builder, region: Region, forcedHeight?: number): Built {
  const { rng } = b;
  const width = region.xr - region.xl;
  const levels = region.lane ? rng.int(1, 2) : rng.int(2, 3);
  const h = forcedHeight ?? levels * rng.range(165, 200) + 90;
  const spacing = (h - 110) / levels;
  for (let i = 0; i < levels; i++) {
    const y = region.y0 + 80 + spacing * (i + 0.5);
    const angle = rng.sign() * deg(rng.range(11, 19));
    let length = rng.range(region.lane ? 110 : 170, region.lane ? 170 : 270);
    let halfW = (Math.cos(angle) * length) / 2;
    let maxAmp = width / 2 - halfW - SAFE_GAP_MOVING - 12;
    if (maxAmp < 60) {
      length = Math.max(90, (width / 2 - SAFE_GAP_MOVING - 72) * 2);
      halfW = (Math.cos(angle) * length) / 2;
      maxAmp = width / 2 - halfW - SAFE_GAP_MOVING - 12;
    }
    const slider: SliderItem = {
      kind: 'slider',
      id: b.id(),
      x: (region.xl + region.xr) / 2,
      y,
      length,
      thickness: 16,
      angle,
      amplitude: rng.range(0.55, 0.95) * maxAmp,
      period: rng.range(2.2, 3.6),
      phase: rng.range(0, Math.PI * 2),
    };
    b.tryAdd(slider);
  }
  b.sprinklePegs(region, region.y0 + 40, region.y0 + h - 30, region.lane ? 2 : rng.int(3, 6));
  return {
    type: 'sliders',
    label: rng.pick(LABELS.sliders),
    height: h,
    progress: { kind: 'vertical' },
    exit: { x: (region.xl + region.xr) / 2, spread: width / 2 },
    estimate: h / 785,
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
    estimate: h / 810,
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
      estimate: 0.28 + (24 + h) / 960,
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
    estimate: 0.26 + (24 + h) / 960,
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
      return buildSpinners(b, region, h);
    case 'sliders':
      return buildSliders(b, region, h);
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
  const types: LaneType[] = rng.shuffle(['zigzag', 'pegs', 'bumpers', 'spinners', 'sliders', 'drop'] as LaneType[]);
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
    estimate: 0.35 + (left.estimate + right.estimate) / 2,
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
    estimate: 0.3 + h / 1000,
    weight: h,
  };
  return { built, finishY, finishX1: c - w / 2, finishX2: c + w / 2, bottom: basinY + 60 };
}

// ---------------------------------------------------------------------------
// Course assembly
// ---------------------------------------------------------------------------

type FillerType = 'pegs' | 'zigzag' | 'mud' | 'bumpers' | 'spinners' | 'sliders' | 'drop' | 'funnel' | 'split';

const AVERAGE_ESTIMATE: Record<FillerType, number> = {
  pegs: 1.0,
  zigzag: 3.1,
  mud: 4.5,
  bumpers: 1.0,
  spinners: 0.6,
  sliders: 0.6,
  drop: 0.5,
  funnel: 0.6,
  split: 1.8,
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
      return buildSpinners(b, region);
    case 'sliders':
      return buildSliders(b, region);
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
  const fits = (t: FillerType) => (AVERAGE_ESTIMATE[t] <= spare + 0.4 ? 1 : 0.05);
  const weights: { item: FillerType; weight: number }[] = [
    { item: 'pegs', weight: 1 * fits('pegs') },
    { item: 'zigzag', weight: 1.1 * fits('zigzag') },
    { item: 'mud', weight: 0.45 * fits('mud') },
    { item: 'bumpers', weight: 1 * fits('bumpers') },
    { item: 'spinners', weight: 1 * fits('spinners') },
    { item: 'sliders', weight: 0.9 * fits('sliders') },
    { item: 'drop', weight: 0.6 * fits('drop') },
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
  const first = rng.pick(['pegs', 'bumpers'] as const);
  let built = buildSection(b, first, region(y, flow));
  push(built, y);
  y += built.height;
  flow = built.exit;
  estimate += built.estimate;
  let prev: FillerType = first;

  const finishEstimate = 0.65;
  const pending: FillerType[] = rng.shuffle(['zigzag', 'split', rng.pick(['spinners', 'sliders'] as FillerType[])]);
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
