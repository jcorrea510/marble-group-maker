import { useCallback, useEffect, useState } from 'react';
import { validateSetup } from './game/grouping';
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS } from './game/names';
import { Rng, randomSeed } from './game/rng';
import type { Participant, RaceResult } from './game/types';
import { loadState, saveState } from './storage';
import { SetupScreen } from './components/SetupScreen';
import { RaceScreen } from './components/RaceScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { Ambient } from './components/Ambient';
import { useToasts } from './components/Toasts';
import { audio } from './game/audio';

type Screen = 'setup' | 'race' | 'results';

export interface RaceConfig {
  raceNumber: number;
  seed: number;
  /** Starting grid order (index 0 = first slot). */
  startOrder: Participant[];
  groupCount: number;
}

/** Testing aid: `?seed=123` replays a specific course. */
function debugSeed(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get('seed'));
  return Number.isInteger(value) && value > 0 ? value >>> 0 : null;
}

export default function App() {
  const [initial] = useState(loadState);
  const [participants, setParticipants] = useState<Participant[]>(initial.participants);
  const [groupCount, setGroupCount] = useState(initial.groupCount);
  const [lastResult, setLastResult] = useState<RaceResult | null>(initial.lastResult);
  const [raceCount, setRaceCount] = useState(initial.raceCount);
  const [muted, setMuted] = useState(initial.muted);
  const [screen, setScreen] = useState<Screen>(initial.showResults ? 'results' : 'setup');
  const [race, setRace] = useState<RaceConfig | null>(null);
  const toasts = useToasts();

  useEffect(() => {
    audio.setMuted(muted);
  }, [muted]);

  // Remember everything between visits (and across page refreshes).
  useEffect(() => {
    saveState({
      participants,
      groupCount,
      lastResult,
      showResults: screen === 'results',
      raceCount,
      muted,
    });
  }, [participants, groupCount, lastResult, screen, raceCount, muted]);

  const clearToasts = toasts.clear;
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (screen === 'race') clearToasts();
  }, [screen, clearToasts]);

  const startRace = useCallback(
    (startOrder: Participant[], groups: number) => {
      const raceNumber = raceCount + 1;
      setRaceCount(raceNumber);
      setRace({ raceNumber, seed: debugSeed() ?? randomSeed(), startOrder, groupCount: groups });
      setScreen('race');
      audio.unlock();
    },
    [raceCount],
  );

  const handleStart = useCallback(() => startRace(participants, groupCount), [participants, groupCount, startRace]);

  /** Same people, same number of groups, brand-new course, reshuffled start grid. */
  const showToast = toasts.show;
  const handleRaceAgain = useCallback(() => {
    // The list may have been edited since the last race, so check it again.
    const check = validateSetup(participants.length, groupCount, { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS });
    if (!check.ok) {
      setScreen('setup');
      showToast(check.message);
      return;
    }
    startRace(new Rng(randomSeed()).shuffle(participants), groupCount);
  }, [participants, groupCount, startRace, showToast]);

  const handleComplete = useCallback((result: RaceResult) => {
    setLastResult(result);
    setScreen('results');
  }, []);

  const handleExitRace = useCallback(() => {
    setScreen('setup');
    setRace(null);
  }, []);

  return (
    <div className="app">
      {screen !== 'race' && <Ambient />}
      {screen === 'setup' && (
        <SetupScreen
          participants={participants}
          groupCount={groupCount}
          onParticipantsChange={setParticipants}
          onGroupCountChange={setGroupCount}
          onStart={handleStart}
          lastResult={lastResult}
          onShowLastResult={() => setScreen('results')}
          toast={toasts.show}
        />
      )}
      {screen === 'race' && race && (
        <RaceScreen
          key={race.raceNumber}
          config={race}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onComplete={handleComplete}
          onExit={handleExitRace}
        />
      )}
      {screen === 'results' && lastResult && (
        <ResultsScreen
          result={lastResult}
          onRaceAgain={handleRaceAgain}
          onEdit={() => setScreen('setup')}
          toast={toasts.show}
        />
      )}
      {toasts.element}
    </div>
  );
}
