import { test } from 'vitest';
import { generateTrackWithInfo } from '../../src/game/track/generator';
import { runRace } from './helpers';

test('calibrate section estimates', () => {
  const ratios: Record<string, number[]> = {};
  const totals: string[] = [];
  const races = Number(process.env.RACES ?? 20);
  for (const count of [6, 12, 24, 40]) {
    for (let i = 0; i < races; i++) {
      const seed = 50_000 + i * 104729 + count * 13;
      const r = runRace(seed, count);
      const { track } = generateTrackWithInfo(seed, count);
      track.sections.forEach((s, k) => {
        const actual = r.sectionTimes[k];
        if (!Number.isFinite(actual) || s.estimate <= 0) return;
        (ratios[s.type] ??= []).push(actual / s.estimate);
      });
      totals.push(`${count}:${(r.medianMs / 1000).toFixed(1)}/${(r.lastMs / 1000).toFixed(1)}(est ${r.estimate.toFixed(1)})`);
    }
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const [type, list] of Object.entries(ratios)) {
    process.stdout.write(`${type.padEnd(9)} n=${String(list.length).padStart(3)} median ratio=${med(list).toFixed(2)}\n`);
  }
  process.stdout.write(totals.join('  ') + '\n');
});
