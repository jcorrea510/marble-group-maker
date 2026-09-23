import { describe, expect, it } from 'vitest';
import { cleanName, initials, parseNames, uniqueName } from '../../src/game/names';

describe('parseNames', () => {
  it('turns one name per line into a list (the example from the brief)', () => {
    const text = 'John\nSarah\nMike\nAlex\nEmma\nChris\nJack\nNicole';
    expect(parseNames(text)).toEqual(['John', 'Sarah', 'Mike', 'Alex', 'Emma', 'Chris', 'Jack', 'Nicole']);
  });

  it('ignores blank lines, extra spaces and Windows line endings', () => {
    expect(parseNames('  John  \r\n\r\n   \nSarah   Lee\n\n')).toEqual(['John', 'Sarah Lee']);
  });

  it('also splits on commas, semicolons and tabs', () => {
    expect(parseNames('John, Sarah;Mike\tAlex')).toEqual(['John', 'Sarah', 'Mike', 'Alex']);
  });

  it('strips list markers from copied lists', () => {
    expect(parseNames('1. John\n2) Sarah\n- Mike\n• Alex\n* Emma')).toEqual(['John', 'Sarah', 'Mike', 'Alex', 'Emma']);
  });

  it('returns nothing for empty input', () => {
    expect(parseNames('')).toEqual([]);
    expect(parseNames('\n \n , ,')).toEqual([]);
  });

  it('keeps names that merely start with a number', () => {
    expect(cleanName('3D Team')).toBe('3D Team');
  });

  it('limits very long names', () => {
    expect(cleanName('A'.repeat(80)).length).toBeLessThanOrEqual(24);
  });
});

describe('uniqueName', () => {
  it('adds a number to duplicates (case-insensitive)', () => {
    expect(uniqueName('Alex', ['alex'])).toBe('Alex 2');
    expect(uniqueName('Alex', ['Alex', 'Alex 2'])).toBe('Alex 3');
    expect(uniqueName('Sam', ['Alex'])).toBe('Sam');
  });
});

describe('initials', () => {
  it('builds short badges', () => {
    expect(initials('Sarah Lee')).toBe('SL');
    expect(initials('mike')).toBe('MI');
  });
});
