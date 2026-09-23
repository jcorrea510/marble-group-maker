import { DESIGN_DIAMETER, MIN_SLOPE_DEG, SAFE_GAP, SAFE_GAP_MOVING } from './constants';
import { isMoving, itemGap, itemYRange } from './geometry';
import type { Track, TrackItem } from './types';

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/**
 * Double-checks a generated course against the playability rules:
 *
 * 1. No "almost touching" obstacles: two things are either connected on
 *    purpose or far enough apart for the biggest marble to pass between.
 *    (A gap slightly smaller than a marble is exactly how marbles get wedged.)
 * 2. Moving parts never touch anything and keep extra clearance.
 * 3. Every ramp / funnel wall slopes downhill enough that marbles can't rest.
 * 4. Everything stays inside the outer walls, and the finish is reachable.
 */
export function validateTrack(track: Track): ValidationResult {
  const problems: string[] = [];
  const solid = track.items.filter((i) => i.kind !== 'zone');

  // Sort by top edge so we only compare nearby items.
  const sorted = solid
    .map((item) => ({ item, range: itemYRange(item) }))
    .sort((a, b) => a.range[0] - b.range[0]);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.range[0] > a.range[1] + SAFE_GAP_MOVING) break;
      if (isOuterWall(a.item, track) || isOuterWall(b.item, track)) {
        // Outer walls only matter for optional / moving items (structural pieces attach to them).
        if (!checkAgainstOuter(a.item, b.item, track, problems)) continue;
        continue;
      }
      checkPair(a.item, b.item, problems);
    }
  }

  for (const item of solid) {
    if (item.kind === 'wall' && (item.style === 'ramp' || item.style === 'funnel' || item.style === 'deflector')) {
      const dx = Math.abs(item.b.x - item.a.x);
      const dy = Math.abs(item.b.y - item.a.y);
      const slope = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (slope < MIN_SLOPE_DEG) problems.push(`Wall ${item.id} is too flat (${slope.toFixed(1)}°)`);
    }
    const [top, bottom] = itemYRange(item);
    if (top < -100 || bottom > track.height + 100) problems.push(`Item ${item.id} is outside the course`);
  }

  if (track.finishY <= track.gateY) problems.push('Finish line is above the start');
  if (track.finishX2 - track.finishX1 < DESIGN_DIAMETER * 3) problems.push('Finish opening too narrow');
  if (track.startSlots.length === 0) problems.push('No start slots');

  return { ok: problems.length === 0, problems };
}

function isOuterWall(item: TrackItem, track: Track): boolean {
  return (
    item.kind === 'wall' &&
    item.style === 'wall' &&
    (item.b.y - item.a.y > track.height * 0.5 || Math.abs(item.b.x - item.a.x) > track.width * 0.9)
  );
}

function checkAgainstOuter(a: TrackItem, b: TrackItem, track: Track, problems: string[]): boolean {
  const other = isOuterWall(a, track) ? b : a;
  const outer = other === a ? b : a;
  if (isOuterWall(other, track)) return false;
  const gap = itemGap(other, outer);
  if (isMoving(other) && gap < SAFE_GAP_MOVING) {
    problems.push(`Moving item ${other.id} too close to the outer wall (${gap.toFixed(1)})`);
  } else if (other.kind === 'peg' || other.kind === 'bumper') {
    if (gap < SAFE_GAP) problems.push(`Item ${other.id} too close to the outer wall (${gap.toFixed(1)})`);
  } else if (other.kind === 'wall' && gap > 0 && gap < SAFE_GAP) {
    problems.push(`Wall ${other.id} leaves a tight gap at the outer wall (${gap.toFixed(1)})`);
  }
  return true;
}

function checkPair(a: TrackItem, b: TrackItem, problems: string[]) {
  const gap = itemGap(a, b);
  if (isMoving(a) || isMoving(b)) {
    if (gap < SAFE_GAP_MOVING) problems.push(`Moving part ${a.id}/${b.id} too close (${gap.toFixed(1)})`);
    return;
  }
  if (a.kind === 'wall' && b.kind === 'wall') {
    // Walls may be joined on purpose (gap <= 0, e.g. a ramp fixed to the
    // divider, or a deflector sticking out of it), but never nearly touching.
    if (gap > 0.5 && gap < SAFE_GAP) problems.push(`Walls ${a.id}/${b.id} leave a tight gap (${gap.toFixed(1)})`);
    return;
  }
  if (gap < SAFE_GAP) problems.push(`Items ${a.id}/${b.id} too close (${gap.toFixed(1)})`);
}
