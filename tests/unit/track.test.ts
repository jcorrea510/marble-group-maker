import { describe, expect, it } from 'vitest';
import { generateTrack, generateTrackWithInfo } from '../../src/game/track/generator';
import { validateTrack } from '../../src/game/track/validate';
import { DESIGN_DIAMETER, SAFE_GAP } from '../../src/game/track/constants';
import { itemGap } from '../../src/game/track/geometry';
import { runRace } from '../sim/helpers';

const COUNTS = [2, 4, 8, 10, 16, 24, 33, 50];

describe('track generator', () => {
  it('always produces a valid, playable course', () => {
    let maxAttempts = 0;
    for (let i = 0; i < 240; i++) {
      const count = COUNTS[i % COUNTS.length];
      const { track, attempts } = generateTrackWithInfo(i * 2654435761, count);
      maxAttempts = Math.max(maxAttempts, attempts);
      const result = validateTrack(track);
      expect(result.problems).toEqual([]);
      expect(track.startSlots).toHaveLength(count);
    }
    // Regenerating is allowed but should be rare.
    expect(maxAttempts).toBeLessThan(10);
  });

  it('is reproducible from its seed', () => {
    const a = generateTrack(987654, 12);
    const b = generateTrack(987654, 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('generates genuinely different courses for different seeds', () => {
    const layouts = new Set<string>();
    const heights = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const t = generateTrack(seed * 7777, 10);
      layouts.add(t.sections.map((s) => s.type).join(','));
      heights.add(Math.round(t.height));
    }
    expect(layouts.size).toBeGreaterThan(20);
    expect(heights.size).toBeGreaterThan(25);
  });

  it('always includes a split path, ramps, a moving obstacle and a finish funnel', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const t = generateTrack(seed * 31337, 12);
      const types = t.sections.map((s) => s.type);
      expect(types[0]).toBe('start');
      expect(types[types.length - 1]).toBe('finish');
      expect(types).toContain('split');
      expect(types.some((x) => x === 'zigzag' || x === 'mud')).toBe(true);
      expect(t.items.some((i) => i.kind === 'spinner' || i.kind === 'slider' || i.kind === 'pendulum')).toBe(true);
    }
  });

  it('places start slots inside the start box without overlapping', () => {
    for (const count of COUNTS) {
      const t = generateTrack(count * 99, count);
      for (let i = 0; i < t.startSlots.length; i++) {
        const s = t.startSlots[i];
        expect(s.x - t.marbleRadius).toBeGreaterThan(t.innerLeft);
        expect(s.x + t.marbleRadius).toBeLessThan(t.innerRight);
        expect(s.y).toBeLessThan(t.gateY);
        for (let j = i + 1; j < t.startSlots.length; j++) {
          const o = t.startSlots[j];
          expect(Math.hypot(s.x - o.x, s.y - o.y)).toBeGreaterThanOrEqual(t.marbleRadius * 2);
        }
      }
    }
  });

  it('keeps pegs and bumpers far enough apart for the biggest marble', () => {
    const t = generateTrack(424242, 8);
    const round = t.items.filter((i) => i.kind === 'peg' || i.kind === 'bumper');
    for (let i = 0; i < round.length; i++) {
      for (let j = i + 1; j < round.length; j++) {
        expect(itemGap(round[i], round[j])).toBeGreaterThanOrEqual(SAFE_GAP);
      }
    }
    expect(SAFE_GAP).toBeGreaterThan(DESIGN_DIAMETER);
  });

  it('puts the finish line below the start and inside the course', () => {
    const t = generateTrack(5, 20);
    expect(t.finishY).toBeGreaterThan(t.gateY);
    expect(t.finishY).toBeLessThan(t.height);
    expect(t.finishX2 - t.finishX1).toBeGreaterThan(DESIGN_DIAMETER * 3);
  });
});

describe('course coverage', () => {
  it('uses the new section types across many courses', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) for (const s of generateTrack(seed * 104729, 12).sections) seen.add(s.type);
    for (const type of ['pendulums', 'cascade', 'trampolines', 'spinners', 'sliders']) expect(seen).toContain(type);
  });

  it('never leaves marbles a long real free-fall in full races', () => {
    for (const [seed, n] of [
      [9001, 8],
      [9002, 20],
      [9003, 40],
    ]) {
      const run = runRace(seed, n);
      expect(run.timedOut).toBe(false);
      expect(run.maxFreeFall).toBeLessThan(1100);
      expect(run.medianFreeFall).toBeLessThan(450);
    }
  });
});

describe('split lanes', () => {
  it('always contain the moving obstacles their label promises', () => {
    const kindFor: Record<string, string> = { Spinners: 'spinner', Shuttles: 'slider', 'Wrecking balls': 'pendulum' };
    for (let seed = 1; seed <= 120; seed++) {
      const t = generateTrack(seed, 12);
      for (const s of t.sections) {
        for (const lane of s.lanes ?? []) {
          const kind = kindFor[lane.label];
          if (!kind) continue;
          const found = t.items.some((it) => {
            if (it.kind !== kind) return false;
            const x = it.kind === 'pendulum' ? it.pivotX : (it as { x: number }).x;
            const y = it.kind === 'pendulum' ? it.pivotY : (it as { y: number }).y;
            return x > lane.xl && x < lane.xr && y > s.y0 && y < s.y1;
          });
          expect(found, `seed ${seed}: ${lane.label} lane is empty`).toBe(true);
        }
      }
    }
  });
});
