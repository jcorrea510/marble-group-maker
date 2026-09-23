import { MAX_COLOR_INDEX } from './game/colors';
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from './game/names';
import type { Participant, RaceResult } from './game/types';

/**
 * Everything the app remembers between visits lives in the browser's
 * localStorage (nothing is sent to a server). Reads are defensive: if the
 * saved data is missing or broken, the app simply starts fresh.
 */
const KEY = 'marble-group-maker:v1';

export interface SavedState {
  participants: Participant[];
  groupCount: number;
  lastResult: RaceResult | null;
  showResults: boolean;
  raceCount: number;
  muted: boolean;
}

export const DEFAULT_STATE: SavedState = {
  participants: [],
  groupCount: 2,
  lastResult: null,
  showResults: false,
  raceCount: 0,
  muted: false,
};

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE;
    const data = JSON.parse(raw) as Partial<SavedState>;
    const participants = Array.isArray(data.participants)
      ? data.participants
          .filter(
            (p): p is Participant =>
              !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.colorIndex === 'number',
          )
          .slice(0, MAX_PARTICIPANTS)
          .map((p) => ({
            id: p.id,
            name: p.name.slice(0, MAX_NAME_LENGTH),
            colorIndex: Math.abs(Math.floor(p.colorIndex)) % MAX_COLOR_INDEX,
          }))
      : [];
    const groupCount =
      typeof data.groupCount === 'number' && Number.isFinite(data.groupCount)
        ? Math.max(1, Math.floor(data.groupCount))
        : DEFAULT_STATE.groupCount;
    const lastResult = isResult(data.lastResult) ? data.lastResult : null;
    return {
      participants,
      groupCount,
      lastResult,
      showResults: Boolean(data.showResults) && lastResult !== null,
      raceCount: typeof data.raceCount === 'number' ? data.raceCount : 0,
      muted: Boolean(data.muted),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state: SavedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or disabled (private mode). The app still works.
  }
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
