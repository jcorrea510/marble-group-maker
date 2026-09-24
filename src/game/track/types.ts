export interface Vec {
  x: number;
  y: number;
}

/** Visual flavour of a straight piece of track. */
export type WallStyle =
  | 'wall'
  | 'ramp'
  | 'funnel'
  | 'divider'
  | 'deflector'
  | 'gate'
  | 'basin'
  /** Short slanted plate (waterfall sections and shaft fillers). */
  | 'plate'
  /** Springy bar that launches marbles. */
  | 'trampoline';

/** A thick straight line (with rounded ends). Walls, ramps, funnels... */
export interface WallItem {
  kind: 'wall';
  id: number;
  a: Vec;
  b: Vec;
  thickness: number;
  style: WallStyle;
  /** Optional items may be dropped by the validator if they cause a tight gap. */
  optional?: boolean;
}

/** A small round static post. */
export interface PegItem {
  kind: 'peg';
  id: number;
  x: number;
  y: number;
  r: number;
  optional?: boolean;
}

/** A round bouncy obstacle that flashes when hit. */
export interface BumperItem {
  kind: 'bumper';
  id: number;
  x: number;
  y: number;
  r: number;
  restitution: number;
  optional?: boolean;
}

/** A rotating paddle wheel. Angle = phase + speed * time. */
export interface SpinnerItem {
  kind: 'spinner';
  id: number;
  x: number;
  y: number;
  armLength: number;
  armThickness: number;
  arms: 2 | 3 | 4;
  /** Radians per second (sign = direction). */
  speed: number;
  phase: number;
}

/** A tilted bar that slides back and forth horizontally. */
export interface SliderItem {
  kind: 'slider';
  id: number;
  /** Centre of travel. */
  x: number;
  y: number;
  length: number;
  thickness: number;
  angle: number;
  amplitude: number;
  /** Seconds for one full back-and-forth cycle. */
  period: number;
  phase: number;
}

/** A wrecking ball swinging on an arm. Angle = amplitude * sin(2π t / period + phase). */
export interface PendulumItem {
  kind: 'pendulum';
  id: number;
  pivotX: number;
  pivotY: number;
  length: number;
  bobR: number;
  /** Maximum swing angle from vertical (radians). */
  amplitude: number;
  period: number;
  phase: number;
}

/** Slow-down area ("mud") – marbles inside get extra air drag. */
export interface ZoneItem {
  kind: 'zone';
  id: number;
  zone: 'mud';
  /** Convex polygon, clockwise or counter-clockwise. */
  polygon: Vec[];
  drag: number;
}

export type TrackItem = WallItem | PegItem | BumperItem | SpinnerItem | SliderItem | PendulumItem | ZoneItem;

export interface Ramp {
  /** High end. */
  a: Vec;
  /** Low end. */
  b: Vec;
}

/**
 * How "far along" a marble is inside a section. Used for the live
 * leaderboard and the camera. (The final result only uses the finish line.)
 */
export type ProgressModel =
  | { kind: 'vertical' }
  | { kind: 'ramps'; ramps: Ramp[] }
  | { kind: 'split'; splitY: number; dividerX: number; left: ProgressModel; right: ProgressModel };

export type SectionType =
  | 'start'
  | 'pegs'
  | 'zigzag'
  | 'funnel'
  | 'bumpers'
  | 'spinners'
  | 'sliders'
  | 'drop'
  | 'split'
  | 'mud'
  | 'pendulums'
  | 'cascade'
  | 'trampolines'
  | 'finish';

export interface Section {
  type: SectionType;
  /** Fun name shown on the track and in the minimap, e.g. "Spin Cycle". */
  label: string;
  y0: number;
  y1: number;
  progress: ProgressModel;
  /** Relative length used when converting section progress to overall progress. */
  weight: number;
  /** Estimated seconds a typical marble spends in this section. */
  estimate: number;
  /** Lane labels for split sections. */
  lanes?: { label: string; xl: number; xr: number }[];
}

export interface Track {
  seed: number;
  code: string;
  width: number;
  height: number;
  /** Inner edges of the outer side walls. */
  innerLeft: number;
  innerRight: number;
  items: TrackItem[];
  sections: Section[];
  /** Where each marble starts, in starting-grid order. */
  startSlots: Vec[];
  marbleRadius: number;
  /** Ids of the start gate pieces (removed when the race starts). */
  gateIds: number[];
  gateY: number;
  finishY: number;
  finishX1: number;
  finishX2: number;
  /** Rough time estimate (seconds) used when assembling the course. */
  estimatedSeconds: number;
}
