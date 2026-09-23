import { describe, expect, it } from 'vitest';
import {
  describeGroupSizes,
  groupIndexForPosition,
  groupSizes,
  splitIntoGroups,
  validateSetup,
} from '../../src/game/grouping';

describe('groupSizes', () => {
  it('splits evenly when possible', () => {
    expect(groupSizes(12, 3)).toEqual([4, 4, 4]);
    expect(groupSizes(4, 2)).toEqual([2, 2]);
  });

  it('spreads the remainder over the first groups (sizes differ by at most 1)', () => {
    expect(groupSizes(10, 3)).toEqual([4, 3, 3]);
    expect(groupSizes(7, 4)).toEqual([2, 2, 2, 1]);
    expect(groupSizes(23, 5)).toEqual([5, 5, 5, 4, 4]);
  });

  it('always adds up to the total', () => {
    for (let total = 1; total <= 60; total++) {
      for (let g = 1; g <= total; g++) {
        const sizes = groupSizes(total, g);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('splitIntoGroups', () => {
  it('matches the example: 12 people, 3 groups', () => {
    const order = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(splitIntoGroups(order, 3)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);
  });

  it('keeps finishing order inside each group', () => {
    const order = ['Sarah', 'Jack', 'Alex', 'Emma', 'Mike', 'Chris', 'John', 'Nicole'];
    expect(splitIntoGroups(order, 2)).toEqual([
      ['Sarah', 'Jack', 'Alex', 'Emma'],
      ['Mike', 'Chris', 'John', 'Nicole'],
    ]);
  });

  it('handles uneven splits', () => {
    const order = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(splitIntoGroups(order, 3)).toEqual([[1, 2, 3, 4], [5, 6, 7], [8, 9, 10]]);
  });
});

describe('groupIndexForPosition', () => {
  it('agrees with splitIntoGroups', () => {
    const total = 11;
    const groups = splitIntoGroups(Array.from({ length: total }, (_, i) => i), 4);
    groups.forEach((members, g) => {
      for (const pos of members) expect(groupIndexForPosition(pos, total, 4)).toBe(g);
    });
  });
});

describe('describeGroupSizes', () => {
  it('describes even and uneven splits', () => {
    expect(describeGroupSizes(12, 3)).toBe('3 groups of 4');
    expect(describeGroupSizes(10, 3)).toBe('1 × 4 people, 2 × 3 people');
    expect(describeGroupSizes(3, 5)).toBe('');
  });
});

describe('validateSetup', () => {
  const limits = { min: 2, max: 50 };
  it('rejects zero participants', () => {
    expect(validateSetup(0, 2, limits).ok).toBe(false);
  });
  it('rejects a single participant', () => {
    expect(validateSetup(1, 1, limits).ok).toBe(false);
  });
  it('rejects more groups than participants', () => {
    const v = validateSetup(4, 5, limits);
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/5 groups from 4 people/);
  });
  it('rejects zero groups and too many participants', () => {
    expect(validateSetup(6, 0, limits).ok).toBe(false);
    expect(validateSetup(51, 3, limits).ok).toBe(false);
  });
  it('accepts valid setups', () => {
    expect(validateSetup(4, 2, limits).ok).toBe(true);
    expect(validateSetup(10, 3, limits).ok).toBe(true);
    expect(validateSetup(4, 4, limits).ok).toBe(true);
  });
});
