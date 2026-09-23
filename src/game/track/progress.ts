import { clamp, fractionAlong, lineYAt } from './geometry';
import type { ProgressModel, Section, Track } from './types';

/**
 * Converts a marble position into "how far along the course" it is (0..1).
 *
 * On zig-zag ramps, a marble at the far end of a ramp is ahead of one that
 * just landed on it even though both are at almost the same height, so ramp
 * sections measure progress along the ramps instead of straight down.
 *
 * This only drives the live leaderboard and the camera; the official result
 * comes from the order in which marbles cross the finish line.
 */
export class ProgressMap {
  private readonly starts: number[] = [];
  private readonly total: number;

  constructor(private readonly track: Track) {
    let acc = 0;
    for (const s of track.sections) {
      this.starts.push(acc);
      acc += s.weight;
    }
    this.total = acc;
  }

  sectionIndexAt(y: number): number {
    const { sections } = this.track;
    let lo = 0;
    let hi = sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sections[mid].y0 <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  progressAt(x: number, y: number): number {
    const { sections } = this.track;
    if (y >= this.track.finishY) return 1;
    const i = this.sectionIndexAt(y);
    const s = sections[i];
    const f = sectionFraction(s, s.progress, x, y, s.y0, s.y1);
    return clamp((this.starts[i] + f * s.weight) / this.total, 0, 1);
  }
}

function sectionFraction(
  section: Section,
  model: ProgressModel,
  x: number,
  y: number,
  y0: number,
  y1: number,
): number {
  switch (model.kind) {
    case 'vertical':
      return clamp((y - y0) / Math.max(1, y1 - y0), 0, 1);
    case 'ramps': {
      const k = model.ramps.length;
      for (let j = 0; j < k; j++) {
        const r = model.ramps[j];
        if (y < lineYAt(r.a, r.b, x) + 4) {
          return clamp((j + fractionAlong(r.a, r.b, x)) / k, 0, 1) * 0.94 + 0.03;
        }
      }
      return 0.97 + 0.03 * clamp((y - model.ramps[k - 1].b.y) / Math.max(1, y1 - model.ramps[k - 1].b.y), 0, 1);
    }
    case 'split': {
      if (y < model.splitY) return 0.1 * clamp((y - y0) / Math.max(1, model.splitY - y0), 0, 1);
      const lane = x < model.dividerX ? model.left : model.right;
      return 0.1 + 0.9 * sectionFraction(section, lane, x, y, model.splitY, y1);
    }
  }
}
