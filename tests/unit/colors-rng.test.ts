import { describe, expect, it } from 'vitest';
import { MAX_COLOR_INDEX, marbleStyle, nextFreeColorIndex } from '../../src/game/colors';
import { Rng, seedToCode } from '../../src/game/rng';

describe('marble colors', () => {
  it('gives every marble a unique look (up to 60 marbles)', () => {
    const looks = new Set<string>();
    for (let i = 0; i < MAX_COLOR_INDEX; i++) {
      const s = marbleStyle(i);
      looks.add(`${s.base}/${s.swirl}`);
    }
    expect(looks.size).toBe(MAX_COLOR_INDEX);
  });

  it('first 20 marbles are all different base colors', () => {
    const bases = new Set(Array.from({ length: 20 }, (_, i) => marbleStyle(i).base));
    expect(bases.size).toBe(20);
  });

  it('two-tone marbles always have a swirl that differs from the base', () => {
    for (let i = 20; i < MAX_COLOR_INDEX; i++) {
      const s = marbleStyle(i);
      expect(s.twoTone).toBe(true);
      expect(s.swirl).not.toBe(s.base);
    }
  });

  it('reuses the lowest free color', () => {
    expect(nextFreeColorIndex([])).toBe(0);
    expect(nextFreeColorIndex([0, 1, 3])).toBe(2);
  });
});

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds and stays in range', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const x = a.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x === b.next()) same++;
    }
    expect(same).toBeLessThan(3);
  });

  it('shuffles without losing items', () => {
    const rng = new Rng(7);
    const list = Array.from({ length: 30 }, (_, i) => i);
    expect([...rng.shuffle(list)].sort((x, y) => x - y)).toEqual(list);
  });

  it('makes readable course codes', () => {
    expect(seedToCode(123456)).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  });
});
