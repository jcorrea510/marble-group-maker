/** World units are roughly "pixels at 100% zoom". The course is tall and narrow. */
export const TRACK_WIDTH = 1000;
export const SIDE_WALL = 40;
export const INNER_LEFT = SIDE_WALL;
export const INNER_RIGHT = TRACK_WIDTH - SIDE_WALL;

/**
 * Every gap in the course is sized for the BIGGEST marble we ever use, so
 * smaller marbles (used when there are many racers) always fit too.
 */
export const DESIGN_DIAMETER = 32;

/** Unconnected obstacles must be at least this far apart (surface to surface). */
export const SAFE_GAP = DESIGN_DIAMETER * 1.3;
/** Extra room around moving parts so marbles never get pinched. */
export const SAFE_GAP_MOVING = DESIGN_DIAMETER * 1.55;

/** Ramps and funnel walls are never flatter than this, so marbles can't park on them. */
export const MIN_SLOPE_DEG = 6.5;

export function marbleRadiusFor(count: number): number {
  if (count <= 10) return 16;
  if (count <= 20) return 14.5;
  if (count <= 32) return 13;
  return 11.5;
}
