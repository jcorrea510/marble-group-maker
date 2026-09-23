import { useEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from 'react';
import { nextFreeColorIndex, groupColor } from '../game/colors';
import { describeGroupSizes, groupSizes, validateSetup } from '../game/grouping';
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, parseNames, uniqueName } from '../game/names';
import { Rng, randomSeed } from '../game/rng';
import type { Participant, RaceResult } from '../game/types';
import { newId } from '../storage';
import type { ToastOptions } from './Toasts';
import { Logo } from './Logo';
import { MarbleSwatch } from './MarbleSwatch';
import {
  CloseIcon,
  EyeIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  ShuffleIcon,
  SparkIcon,
  TrashIcon,
  UsersIcon,
} from './Icons';
import './SetupScreen.css';

const SAMPLE_NAMES = ['John', 'Sarah', 'Mike', 'Alex', 'Emma', 'Chris', 'Jack', 'Nicole'];

interface Props {
  participants: Participant[];
  groupCount: number;
  onParticipantsChange: (list: Participant[]) => void;
  onGroupCountChange: (count: number) => void;
  onStart: () => void;
  lastResult: RaceResult | null;
  onShowLastResult: () => void;
  toast: (message: string, options?: ToastOptions) => void;
}

export function SetupScreen({
  participants,
  groupCount,
  onParticipantsChange,
  onGroupCountChange,
  onStart,
  lastResult,
  onShowLastResult,
  toast,
}: Props) {
  const [draft, setDraft] = useState('');
  const [shuffleTick, setShuffleTick] = useState(0);
  const [groupInput, setGroupInput] = useState(String(groupCount));
  const [lastSyncedGroupCount, setLastSyncedGroupCount] = useState(groupCount);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the number box in sync when the count changes elsewhere (buttons, chips).
  if (groupCount !== lastSyncedGroupCount) {
    setLastSyncedGroupCount(groupCount);
    setGroupInput(String(groupCount));
  }

  const count = participants.length;
  const validation = validateSetup(count, groupCount, { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS });
  const sizes = useMemo(
    () => (groupCount >= 1 && groupCount <= Math.max(1, count) && count > 0 ? groupSizes(count, groupCount) : []),
    [count, groupCount],
  );

  function addNames(names: string[]) {
    if (names.length === 0) return 0;
    const room = MAX_PARTICIPANTS - participants.length;
    if (room <= 0) {
      toast(`The track fits up to ${MAX_PARTICIPANTS} marbles.`);
      return 0;
    }
    const taken = participants.map((p) => p.name);
    const colors = participants.map((p) => p.colorIndex);
    const added: Participant[] = [];
    let renamed = 0;
    for (const raw of names.slice(0, room)) {
      const name = uniqueName(raw, taken);
      if (name !== raw) renamed++;
      const colorIndex = nextFreeColorIndex(colors);
      taken.push(name);
      colors.push(colorIndex);
      added.push({ id: newId(), name, colorIndex });
    }
    onParticipantsChange([...participants, ...added]);

    const skipped = names.length - added.length;
    const parts = [added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} people`];
    if (renamed > 0) parts.push(`${renamed} duplicate${renamed > 1 ? 's' : ''} numbered`);
    if (skipped > 0) parts.push(`${skipped} didn't fit (max ${MAX_PARTICIPANTS})`);
    if (added.length > 1 || renamed > 0 || skipped > 0) toast(parts.join(' · '));
    return added.length;
  }

  function commitDraft() {
    const names = parseNames(draft);
    if (names.length === 0) return;
    addNames(names);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if ((e.ctrlKey || e.metaKey) && !draft.trim()) return; // nothing typed: let Ctrl+Enter start the race
      e.preventDefault();
      e.stopPropagation(); // typed names are added first; press again to start
      commitDraft();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData('text');
    // A pasted list (several lines / commas) is added straight away.
    if (/[\n,;\t]/.test(text.trim())) {
      e.preventDefault();
      const names = parseNames(text);
      if (names.length > 0) addNames(names);
    }
  }

  function remove(p: Participant) {
    const before = participants;
    onParticipantsChange(participants.filter((x) => x.id !== p.id));
    toast(`Removed ${p.name}`, { action: { label: 'Undo', onClick: () => onParticipantsChange(before) } });
  }

  function clearAll() {
    if (count === 0) return;
    const before = participants;
    onParticipantsChange([]);
    toast(`Cleared ${before.length} people`, { action: { label: 'Undo', onClick: () => onParticipantsChange(before) } });
    inputRef.current?.focus();
  }

  function shuffle() {
    if (count < 2) return;
    onParticipantsChange(new Rng(randomSeed()).shuffle(participants));
    setShuffleTick((t) => t + 1);
    toast('Starting order shuffled');
  }

  function setGroups(n: number) {
    const next = Math.max(1, Math.min(MAX_PARTICIPANTS, Math.round(n)));
    onGroupCountChange(next);
    setGroupInput(String(next));
  }

  function handleGroupInput(value: string) {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 2);
    setGroupInput(digits);
    const n = parseInt(digits, 10);
    const next = Number.isFinite(n) && n >= 1 ? n : 0;
    setLastSyncedGroupCount(next); // don't overwrite what the user is typing
    onGroupCountChange(next);
  }

  // Ctrl/Cmd + Enter starts the race from anywhere on the page.
  const canStart = validation.ok;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canStart) {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canStart, onStart]);

  const groupPickerMax = Math.max(2, Math.min(MAX_PARTICIPANTS, count));
  const quickPicks = [2, 3, 4, 5, 6].filter((n) => n <= Math.max(6, count));

  return (
    <main className="setup screen-enter">
      <header className="setup-header">
        <Logo />
        {lastResult && (
          <button className="btn btn-ghost" onClick={onShowLastResult}>
            <EyeIcon size={16} /> Last results
          </button>
        )}
      </header>

      <section className="setup-hero">
        <h1>
          Make teams
          <br />
          the <span className="grad-text">fun way.</span>
        </h1>
        <p>
          Everyone becomes a marble. A brand-new course is built for every race, and the order the marbles cross the
          finish line decides the groups. About 20 seconds, zero arguments.
        </p>
      </section>

      <div className="setup-grid">
        <section className="card setup-people" aria-labelledby="people-title">
          <div className="card-head">
            <div>
              <div className="eyebrow">Step 1</div>
              <h2 id="people-title">Who's racing?</h2>
            </div>
            <span className="count-badge" data-testid="participant-count">
              <UsersIcon size={15} /> {count}
              <span className="count-max">/ {MAX_PARTICIPANTS}</span>
            </span>
          </div>

          <div className="name-input">
            <label htmlFor="name-input" className="visually-hidden">
              Add names
            </label>
            <textarea
              id="name-input"
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder={'Type a name and press Enter…\nor paste a whole list, one name per line'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              maxLength={4000}
              autoFocus={count === 0}
              data-testid="name-input"
            />
            <button className="btn btn-primary add-btn" onClick={commitDraft} disabled={!draft.trim()} data-testid="add-button">
              <PlusIcon size={18} /> Add
            </button>
          </div>
          <p className="hint">
            <span className="kbd">Enter</span> adds · <span className="kbd">Shift</span>+<span className="kbd">Enter</span>{' '}
            new line · pasting a list adds everyone at once · <span className="kbd">Ctrl</span>+
            <span className="kbd">Enter</span> starts
          </p>

          {count === 0 ? (
            <div className="empty-state">
              <div className="empty-marbles" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <MarbleSwatch key={i} colorIndex={i * 3} size={i === 2 ? 34 : 24} />
                ))}
              </div>
              <p>No racers yet. Paste your list above, or take it for a spin with sample names.</p>
              <button className="btn btn-secondary" onClick={() => addNames(SAMPLE_NAMES)} data-testid="sample-names">
                <SparkIcon size={16} /> Use sample names
              </button>
            </div>
          ) : (
            <>
              <div className="list-toolbar">
                <span className="list-caption">Starting grid order</span>
                <div className="list-actions">
                  <button className="btn btn-ghost" onClick={shuffle} disabled={count < 2} data-testid="shuffle">
                    <ShuffleIcon size={16} /> Shuffle
                  </button>
                  <button className="btn btn-ghost" onClick={clearAll} data-testid="clear-all">
                    <TrashIcon size={16} /> Clear all
                  </button>
                </div>
              </div>
              <ol className={`people-list${shuffleTick ? ' shuffled' : ''}`} key={shuffleTick} data-testid="participant-list">
                {participants.map((p, i) => (
                  <li key={p.id} className="person" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                    <span className="person-num">{i + 1}</span>
                    <MarbleSwatch colorIndex={p.colorIndex} />
                    <span className="person-name" title={p.name}>
                      {p.name}
                    </span>
                    <button className="icon-btn person-remove" onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>
                      <CloseIcon size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <aside className="setup-side">
          <section className="card setup-groups" aria-labelledby="groups-title">
            <div className="eyebrow">Step 2</div>
            <h2 id="groups-title">How many groups?</h2>

            <div className="stepper">
              <button
                className="stepper-btn"
                onClick={() => setGroups(groupCount - 1)}
                disabled={groupCount <= 1}
                aria-label="Fewer groups"
                data-testid="groups-minus"
              >
                <MinusIcon />
              </button>
              <input
                className="stepper-value"
                inputMode="numeric"
                aria-label="Number of groups"
                value={groupInput}
                onChange={(e) => handleGroupInput(e.target.value)}
                onBlur={() => {
                  if (!groupInput || groupCount < 1) setGroups(1);
                }}
                data-testid="group-count"
              />
              <button
                className="stepper-btn"
                onClick={() => setGroups(groupCount + 1)}
                disabled={groupCount >= groupPickerMax}
                aria-label="More groups"
                data-testid="groups-plus"
              >
                <PlusIcon />
              </button>
            </div>

            <div className="quick-picks" role="group" aria-label="Quick group counts">
              {quickPicks.map((n) => (
                <button
                  key={n}
                  className={`chip${n === groupCount ? ' active' : ''}`}
                  onClick={() => setGroups(n)}
                  disabled={count > 0 && n > count}
                >
                  {n}
                </button>
              ))}
            </div>

            {sizes.length > 0 && validation.ok ? (
              <div className="group-preview" data-testid="group-preview">
                <p className="group-summary">{describeGroupSizes(count, groupCount)}</p>
                <div className="group-bars">
                  {sizes.map((size, g) => (
                    <div className="group-bar" key={g} style={{ '--g': groupColor(g) } as CSSProperties}>
                      <span className="group-bar-label">G{g + 1}</span>
                      <span className="group-dots">
                        {Array.from({ length: size }, (_, k) => (
                          <i key={k} />
                        ))}
                      </span>
                      <span className="group-bar-size">{size}</span>
                    </div>
                  ))}
                </div>
                <p className="group-note">1st place onwards fills Group 1, then Group 2, and so on.</p>
              </div>
            ) : (
              <div className="group-preview muted">
                <p className="group-summary">
                  {count === 0 ? 'Add people to preview the groups.' : validation.message}
                </p>
              </div>
            )}
          </section>

          <div className="setup-cta">
            <button className="btn btn-primary btn-lg start-btn" onClick={onStart} disabled={!validation.ok} data-testid="start-race">
              <PlayIcon size={18} /> Start the race
            </button>
            <p className={`cta-note${validation.ok ? '' : ' warn'}`} role="status" data-testid="setup-message">
              {validation.ok ? `${count} marbles · ${groupCount} group${groupCount > 1 ? 's' : ''} · new random course` : validation.message}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
