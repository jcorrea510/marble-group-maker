import { MAX_COLOR_INDEX } from './game/colors';
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from './game/names';
import type { GroupMode } from './game/grouping';
import type { Participant, RaceResult } from './game/types';

/**
 * Everything the app remembers between visits lives in the browser's
 * localStorage (nothing is sent to a server). Reads are defensive: if the
 * saved data is missing or broken, the app simply starts fresh.
 *
 * Version 2 adds saved classes ("Period 1", "Period 2", ...). Data saved by
 * version 1 (a single list) is moved into "Period 1" automatically.
 */
const KEY = 'marble-group-maker:v2';
const LEGACY_KEY = 'marble-group-maker:v1';

export const MAX_CLASSES = 20;
export const MAX_CLASS_NAME = 28;

/** One saved class / period with its own list and settings. */
export interface ClassList {
  id: string;
  name: string;
  participants: Participant[];
  groupMode: GroupMode;
  /** Number of groups, or people per group (depending on groupMode). */
  groupValue: number;
  lastResult: RaceResult | null;
}

export interface SavedState {
  classes: ClassList[];
  activeClassId: string;
  showResults: boolean;
  raceCount: number;
  muted: boolean;
}

export function newClass(name: string, participants: Participant[] = []): ClassList {
  return { id: newId(), name, participants, groupMode: 'groups', groupValue: 2, lastResult: null };
}

/** "Period 1", "Period 2", ... – the first number not already used. */
export function nextClassName(classes: readonly ClassList[]): string {
  const taken = new Set(classes.map((c) => c.name.trim().toLowerCase()));
  for (let i = 1; ; i++) if (!taken.has(`period ${i}`)) return `Period ${i}`;
}

export function defaultState(): SavedState {
  const first = newClass('Period 1');
  return { classes: [first], activeClassId: first.id, showResults: false, raceCount: 0, muted: false };
}

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseState(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrateLegacy(JSON.parse(legacy));
  } catch {
    // Broken data: start fresh.
  }
  return defaultState();
}

export function saveState(state: SavedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or disabled (private mode). The app still works.
  }
}

function parseState(data: Partial<SavedState>): SavedState {
  const classes = Array.isArray(data.classes)
    ? data.classes.map(parseClass).filter((c): c is ClassList => c !== null).slice(0, MAX_CLASSES)
    : [];
  if (classes.length === 0) return defaultState();
  const active = classes.find((c) => c.id === data.activeClassId) ?? classes[0];
  return {
    classes,
    activeClassId: active.id,
    showResults: Boolean(data.showResults) && active.lastResult !== null,
    raceCount: typeof data.raceCount === 'number' ? data.raceCount : 0,
    muted: Boolean(data.muted),
  };
}

function parseClass(value: unknown): ClassList | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<ClassList>;
  if (typeof c.id !== 'string' || typeof c.name !== 'string') return null;
  const mode: GroupMode = c.groupMode === 'size' ? 'size' : 'groups';
  return {
    id: c.id,
    name: c.name.slice(0, MAX_CLASS_NAME) || 'Class',
    participants: parseParticipants(c.participants),
    groupMode: mode,
    groupValue: parseCount(c.groupValue, 2),
    lastResult: isResult(c.lastResult) ? c.lastResult : null,
  };
}

/** Version 1 stored one list; it becomes "Period 1". */
function migrateLegacy(data: Record<string, unknown>): SavedState {
  const first = newClass('Period 1', parseParticipants(data.participants));
  first.groupValue = parseCount(data.groupCount, 2);
  first.lastResult = isResult(data.lastResult) ? data.lastResult : null;
  return {
    classes: [first],
    activeClassId: first.id,
    showResults: Boolean(data.showResults) && first.lastResult !== null,
    raceCount: typeof data.raceCount === 'number' ? data.raceCount : 0,
    muted: Boolean(data.muted),
  };
}

function parseCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function parseParticipants(value: unknown): Participant[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (p): p is Participant =>
        !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.colorIndex === 'number',
    )
    .slice(0, MAX_PARTICIPANTS)
    .map((p) => ({
      id: p.id,
      name: p.name.slice(0, MAX_NAME_LENGTH),
      colorIndex: Math.abs(Math.floor(p.colorIndex)) % MAX_COLOR_INDEX,
    }));
}

function isResult(value: unknown): value is RaceResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as RaceResult;
  return (
    Array.isArray(r.order) &&
    r.order.length > 0 &&
    typeof r.groupCount === 'number' &&
    r.order.every((e) => typeof e.name === 'string' && typeof e.position === 'number')
  );
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // randomUUID only works on secure origins; fall through.
    }
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
