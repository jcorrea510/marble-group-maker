import { useCallback, useEffect, useState } from 'react';
import { groupCountFor, validateGroupSetup, type GroupMode } from './game/grouping';
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS } from './game/names';
import { Rng, randomSeed } from './game/rng';
import type { Participant, RaceResult } from './game/types';
import { loadState, saveState, type ClassList } from './storage';
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
  /** The saved class this race belongs to (results are stored there). */
  classId: string;
  className: string;
}

/** Testing aid: `?seed=123` replays a specific course. */
function debugSeed(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get('seed'));
  return Number.isInteger(value) && value > 0 ? value >>> 0 : null;
}

const LIMITS = { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS };

export default function App() {
  const [initial] = useState(loadState);
  const [classes, setClasses] = useState<ClassList[]>(initial.classes);
  const [activeClassId, setActiveClassId] = useState(initial.activeClassId);
  const [raceCount, setRaceCount] = useState(initial.raceCount);
  const [muted, setMuted] = useState(initial.muted);
  const [screen, setScreen] = useState<Screen>(initial.showResults ? 'results' : 'setup');
  const [race, setRace] = useState<RaceConfig | null>(null);
  const toasts = useToasts();

  const active = classes.find((c) => c.id === activeClassId) ?? classes[0];

  useEffect(() => {
    audio.setMuted(muted);
  }, [muted]);

  // Remember everything between visits (and across page refreshes).
  useEffect(() => {
    saveState({ classes, activeClassId: active.id, showResults: screen === 'results', raceCount, muted });
  }, [classes, active.id, screen, raceCount, muted]);

  const clearToasts = toasts.clear;
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (screen === 'race') clearToasts();
  }, [screen, clearToasts]);

  const updateClass = useCallback((id: string, change: Partial<ClassList>) => {
    setClasses((list) => list.map((c) => (c.id === id ? { ...c, ...change } : c)));
  }, []);

  const startRace = useCallback(
    (cls: ClassList, startOrder: Participant[]) => {
      const raceNumber = raceCount + 1;
      setRaceCount(raceNumber);
      setRace({
        raceNumber,
        seed: debugSeed() ?? randomSeed(),
        startOrder,
        groupCount: groupCountFor(startOrder.length, cls.groupMode, cls.groupValue),
        classId: cls.id,
        className: cls.name,
      });
      setScreen('race');
      audio.unlock();
    },
    [raceCount],
  );

  const handleStart = useCallback(() => startRace(active, active.participants), [active, startRace]);

  /** Same people, same group setting, brand-new course, reshuffled start grid. */
  const showToast = toasts.show;
  const handleRaceAgain = useCallback(() => {
    // The list may have been edited since the last race, so check it again.
    const check = validateGroupSetup(active.participants.length, active.groupMode, active.groupValue, LIMITS);
    if (!check.ok) {
      setScreen('setup');
      showToast(check.message);
      return;
    }
    startRace(active, new Rng(randomSeed()).shuffle(active.participants));
  }, [active, startRace, showToast]);

  const handleComplete = useCallback(
    (result: RaceResult) => {
      if (!race) return;
      updateClass(race.classId, { lastResult: { ...result, className: race.className } });
      setActiveClassId(race.classId);
      setScreen('results');
    },
    [race, updateClass],
  );

  const handleExitRace = useCallback(() => {
    setScreen('setup');
    setRace(null);
  }, []);

  return (
    <div className="app">
      {screen !== 'race' && <Ambient />}
      {screen === 'setup' && (
        <SetupScreen
          classes={classes}
          activeClass={active}
          onClassesChange={setClasses}
          onSelectClass={setActiveClassId}
          onParticipantsChange={(participants) => updateClass(active.id, { participants })}
          onGroupSettingChange={(groupMode: GroupMode, groupValue: number) =>
            updateClass(active.id, { groupMode, groupValue })
          }
          onStart={handleStart}
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
      {screen === 'results' && active.lastResult && (
        <ResultsScreen
          result={active.lastResult}
          onRaceAgain={handleRaceAgain}
          onEdit={() => setScreen('setup')}
          toast={toasts.show}
        />
      )}
      {screen === 'results' && !active.lastResult && <ResultsFallback onBack={() => setScreen('setup')} />}
      {toasts.element}
    </div>
  );
}

/** Shown only if results were requested for a class that has none (shouldn't happen). */
function ResultsFallback({ onBack }: { onBack: () => void }) {
  useEffect(() => onBack(), [onBack]);
  return null;
}
