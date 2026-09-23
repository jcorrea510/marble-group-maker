import { generateTrackWithInfo } from '../../src/game/track/generator';
import { RaceSimulation, STEP_MS } from '../../src/game/physics/raceSimulation';
import type { Participant } from '../../src/game/types';
import type { SectionType } from '../../src/game/track/types';

export function makeParticipants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Racer ${i + 1}`, colorIndex: i }));
}

export interface RaceRun {
  seed: number;
  count: number;
  attempts: number;
  estimate: number;
  firstMs: number;
  medianMs: number;
  lastMs: number;
  timedOut: boolean;
  nudges: number;
  rescues: number;
  outOfBounds: number;
  marbleCollisions: number;
  wallMs: number;
  sectionTypes: SectionType[];
  /** Seconds the median marble spent in each section (by index). */
  sectionTimes: number[];
  finishOrder: string[];
  height: number;
}

/** Runs one complete race without any graphics. */
export function runRace(seed: number, count: number, opts: { settleSteps?: number } = {}): RaceRun {
  const t0 = performance.now();
  const { track, attempts } = generateTrackWithInfo(seed, count);
  const sim = new RaceSimulation(track, makeParticipants(count), seed);
  for (let i = 0; i < (opts.settleSteps ?? 120); i++) sim.step();
  sim.start();

  // Record when each marble first enters each section.
  const entered: number[][] = sim.marbles.map(() => track.sections.map(() => NaN));
  let guard = 0;
  while (!sim.isComplete && guard++ < 200_000) {
    sim.step();
    if (sim.stats.steps % 6 === 0) {
      for (const m of sim.marbles) {
        if (m.finished) continue;
        const y = m.body.position.y;
        for (let s = 0; s < track.sections.length; s++) {
          if (y >= track.sections[s].y0 && Number.isNaN(entered[m.index][s])) entered[m.index][s] = sim.raceTimeMs;
        }
      }
    }
  }
  const times = sim.finishingOrder.map((m) => m.finishTimeMs ?? 0);
  const sorted = [...times].sort((a, b) => a - b);

  // Median marble's time per section.
  const sectionTimes = track.sections.map((_, s) => {
    const spans = sim.marbles
      .map((m) => {
        const start = entered[m.index][s];
        const next = s + 1 < track.sections.length ? entered[m.index][s + 1] : (m.finishTimeMs ?? NaN);
        return (next - start) / 1000;
      })
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    return spans.length ? spans[Math.floor(spans.length / 2)] : NaN;
  });

  const run: RaceRun = {
    seed,
    count,
    attempts,
    estimate: track.estimatedSeconds,
    firstMs: sorted[0],
    medianMs: sorted[Math.floor(sorted.length / 2)],
    lastMs: sorted[sorted.length - 1],
    timedOut: sim.endedByTimeLimit,
    nudges: sim.stats.nudges,
    rescues: sim.stats.rescues,
    outOfBounds: sim.stats.outOfBounds,
    marbleCollisions: sim.stats.marbleCollisions,
    wallMs: performance.now() - t0,
    sectionTypes: track.sections.map((s) => s.type),
    sectionTimes,
    finishOrder: sim.finishingOrder.map((m) => m.participant.id),
    height: track.height,
  };
  sim.destroy();
  return run;
}

export const stepMs = STEP_MS;
