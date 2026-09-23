/** A person taking part (one marble each). */
export interface Participant {
  id: string;
  name: string;
  /** Index into the marble color scheme; stays the same across races. */
  colorIndex: number;
}

export interface FinishEntry {
  participantId: string;
  name: string;
  colorIndex: number;
  /** 1-based finishing position. */
  position: number;
  /** Race time in milliseconds when the marble crossed the finish line. */
  finishTimeMs: number;
  /**
   * True only if the race hit its safety time limit before this marble
   * finished; it was then ranked by how far along the course it got.
   */
  rankedByDistance: boolean;
}

export interface RaceResult {
  raceNumber: number;
  seed: number;
  courseCode: string;
  groupCount: number;
  order: FinishEntry[];
  durationMs: number;
  finishedAt: number;
}
