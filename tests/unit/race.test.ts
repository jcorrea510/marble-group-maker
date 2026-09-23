import { describe, expect, it } from 'vitest';
import { generateTrack } from '../../src/game/track/generator';
import { RaceSimulation } from '../../src/game/physics/raceSimulation';
import { splitIntoGroups } from '../../src/game/grouping';
import { makeParticipants, runRace } from '../sim/helpers';

describe('physics race', () => {
  it.each([
    [4, 2],
    [10, 3],
    [24, 5],
  ])('%i marbles all reach the finish (groups: %i)', (count, groups) => {
    const run = runRace(count * 1_000_003, count);
    expect(run.timedOut).toBe(false);
    expect(run.finishOrder).toHaveLength(count);
    expect(new Set(run.finishOrder).size).toBe(count); // everyone exactly once
    expect(run.lastMs / 1000).toBeGreaterThan(8);
    expect(run.lastMs / 1000).toBeLessThan(40);
    const g = splitIntoGroups(run.finishOrder, groups);
    expect(g).toHaveLength(groups);
    expect(g.flat()).toEqual(run.finishOrder);
  });

  it('marbles move, collide and the gate holds them until GO', () => {
    const track = generateTrack(2024, 10);
    const sim = new RaceSimulation(track, makeParticipants(10), 2024);
    const startY = sim.marbles.map((m) => m.body.position.y);
    for (let i = 0; i < 90; i++) sim.step();
    // Gate closed: nobody has fallen out of the start box.
    for (const m of sim.marbles) expect(m.body.position.y).toBeLessThan(track.gateY);
    sim.start();
    for (let i = 0; i < 60 * 4; i++) sim.step();
    const moved = sim.marbles.filter((m, i) => m.body.position.y - startY[i] > 200);
    expect(moved.length).toBe(10);
    expect(sim.stats.marbleCollisions + sim.stats.obstacleCollisions).toBeGreaterThan(20);
    sim.destroy();
  });

  it('records finish times in increasing order', () => {
    const track = generateTrack(77, 8);
    const sim = new RaceSimulation(track, makeParticipants(8), 77);
    sim.start();
    let guard = 0;
    while (!sim.isComplete && guard++ < 60 * 90) sim.step();
    const times = sim.finishingOrder.map((m) => m.finishTimeMs!);
    expect(times).toHaveLength(8);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(sim.finishingOrder.map((m) => m.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    sim.destroy();
  });

  it('is deterministic for the same seed, and different races give different results', () => {
    const a = runRace(31415, 8);
    const b = runRace(31415, 8);
    expect(a.finishOrder).toEqual(b.finishOrder);

    const orders = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) orders.add(runRace(seed * 4099, 8).finishOrder.join(','));
    expect(orders.size).toBeGreaterThan(4);
  });
});
