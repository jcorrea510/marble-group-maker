import { expect, test } from 'vitest';
import { runRace, type RaceRun } from './helpers';

/**
 * Stress test: simulates many complete races (no graphics) with different
 * course seeds and field sizes, and checks every one of them finishes
 * properly. Run with `npm run simulate`.
 */
test('hundreds of races all finish cleanly', () => {
  const counts = [2, 4, 6, 10, 15, 20, 25, 32, 40, 50];
  const perCount = Number(process.env.RACES ?? 12);
  const runs: RaceRun[] = [];
  for (const count of counts) {
    for (let i = 0; i < perCount; i++) runs.push(runRace((i + 1) * 2246822519 + count, count));
  }

  const timedOut = runs.filter((r) => r.timedOut);
  const lasts = runs.map((r) => r.lastMs / 1000).sort((a, b) => a - b);
  const pct = (p: number) => lasts[Math.min(lasts.length - 1, Math.floor(lasts.length * p))].toFixed(1);
  const rescues = runs.reduce((s, r) => s + r.rescues, 0);
  const nudges = runs.reduce((s, r) => s + r.nudges, 0);
  const oob = runs.reduce((s, r) => s + r.outOfBounds, 0);
  const maxAttempts = Math.max(...runs.map((r) => r.attempts));

  process.stdout.write(
    `\n${runs.length} races | last finisher (physics seconds): p5=${pct(0.05)} median=${pct(0.5)} p95=${pct(0.95)} max=${pct(1)}\n` +
      `timed out: ${timedOut.length} | anti-stuck nudges: ${nudges} | ghost rescues: ${rescues} | out-of-bounds: ${oob} | max generation attempts: ${maxAttempts}\n`,
  );
  for (const r of timedOut) process.stdout.write(`  TIMEOUT seed=${r.seed} count=${r.count}\n`);

  expect(timedOut).toEqual([]);
  expect(oob).toBe(0);
  for (const r of runs) {
    expect(new Set(r.finishOrder).size).toBe(r.count);
    expect(r.lastMs).toBeLessThan(45_000);
  }
});
