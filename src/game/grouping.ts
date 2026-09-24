/**
 * Sizes of each group when `total` people are split into `groupCount`
 * groups as evenly as possible. Earlier groups get the extra people.
 *
 *   groupSizes(12, 3) -> [4, 4, 4]
 *   groupSizes(10, 3) -> [4, 3, 3]
 *   groupSizes(7, 4)  -> [2, 2, 2, 1]
 */
export function groupSizes(total: number, groupCount: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error('total must be a non-negative integer');
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new Error('groupCount must be at least 1');
  const base = Math.floor(total / groupCount);
  const extra = total % groupCount;
  return Array.from({ length: groupCount }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Splits a finishing order into consecutive groups:
 * the first finishers go to Group 1, the next to Group 2, and so on.
 */
export function splitIntoGroups<T>(finishingOrder: readonly T[], groupCount: number): T[][] {
  const sizes = groupSizes(finishingOrder.length, groupCount);
  const groups: T[][] = [];
  let index = 0;
  for (const size of sizes) {
    groups.push(finishingOrder.slice(index, index + size));
    index += size;
  }
  return groups;
}

/** Which group (0-based) the person finishing at `position` (0-based) joins. */
export function groupIndexForPosition(position: number, total: number, groupCount: number): number {
  const sizes = groupSizes(total, groupCount);
  let end = 0;
  for (let g = 0; g < sizes.length; g++) {
    end += sizes[g];
    if (position < end) return g;
  }
  return sizes.length - 1;
}

/** Human readable summary like "4 · 4 · 3" or "3 groups of 4". */
export function describeGroupSizes(total: number, groupCount: number): string {
  if (total < 1 || groupCount < 1 || groupCount > total) return '';
  const sizes = groupSizes(total, groupCount);
  const allSame = sizes.every((s) => s === sizes[0]);
  if (allSame) {
    return groupCount === 1
      ? `1 group of ${sizes[0]}`
      : `${groupCount} groups of ${sizes[0]}`;
  }
  const big = sizes[0];
  const small = sizes[sizes.length - 1];
  const bigCount = sizes.filter((s) => s === big).length;
  const smallCount = sizes.length - bigCount;
  return `${bigCount} × ${big} people, ${smallCount} × ${small} people`;
}

export interface SetupValidation {
  ok: boolean;
  message: string;
}

export function validateSetup(
  participantCount: number,
  groupCount: number,
  limits: { min: number; max: number },
): SetupValidation {
  if (participantCount === 0) return { ok: false, message: 'Add some names to get started.' };
  if (participantCount < limits.min)
    return { ok: false, message: `Add at least ${limits.min} people to race.` };
  if (participantCount > limits.max)
    return { ok: false, message: `The track fits up to ${limits.max} marbles. Remove a few names.` };
  if (!Number.isInteger(groupCount) || groupCount < 1)
    return { ok: false, message: 'Choose at least 1 group.' };
  if (groupCount > participantCount)
    return {
      ok: false,
      message: `You can't make ${groupCount} groups from ${participantCount} ${participantCount === 1 ? 'person' : 'people'}.`,
    };
  return { ok: true, message: '' };
}

/** How the teacher sizes groups: a number of groups, or people per group. */
export type GroupMode = 'groups' | 'size';

/**
 * Number of groups for `total` people. In "size" mode, groups hold at most
 * `value` people (10 people, 4 per group -> 3 groups of 4, 3, 3).
 */
export function groupCountFor(total: number, mode: GroupMode, value: number): number {
  if (mode === 'groups') return value;
  if (!Number.isFinite(value) || value < 1 || total < 1) return 0;
  return Math.max(1, Math.ceil(total / Math.floor(value)));
}

/** Validates a setup in either mode, with a message that fits the mode. */
export function validateGroupSetup(
  participantCount: number,
  mode: GroupMode,
  value: number,
  limits: { min: number; max: number },
): SetupValidation {
  if (mode === 'size') {
    const base = validateSetup(participantCount, 1, limits);
    if (!base.ok) return base;
    if (!Number.isInteger(value) || value < 1) return { ok: false, message: 'Choose at least 1 person per group.' };
    if (value > participantCount)
      return { ok: false, message: `There are only ${participantCount} people – choose ${participantCount} or fewer per group.` };
    return { ok: true, message: '' };
  }
  return validateSetup(participantCount, value, limits);
}
