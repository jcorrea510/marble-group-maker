import { useEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from 'react';
import { nextFreeColorIndex, groupColor } from '../game/colors';
import { groupCountFor, groupSizes, validateGroupSetup, type GroupMode } from '../game/grouping';
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, parseNames, uniqueName } from '../game/names';
import { Rng, randomSeed } from '../game/rng';
import type { Participant } from '../game/types';
import { newClass, newId, nextClassName, type ClassList } from '../storage';
import type { ToastOptions } from './Toasts';
import { ClassTabs } from './ClassTabs';
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
  classes: ClassList[];
  activeClass: ClassList;
  onClassesChange: (classes: ClassList[]) => void;
  onSelectClass: (id: string) => void;
  onParticipantsChange: (list: Participant[]) => void;
  onGroupSettingChange: (mode: GroupMode, value: number) => void;
  onStart: () => void;
  onShowLastResult: () => void;
  toast: (message: string, options?: ToastOptions) => void;
}

export function SetupScreen({
  classes,
  activeClass,
  onClassesChange,
  onSelectClass,
  onParticipantsChange,
  onGroupSettingChange,
  onStart,
  onShowLastResult,
  toast,
}: Props) {
  const { participants, groupMode, groupValue, lastResult } = activeClass;
  const [draft, setDraft] = useState('');
  const [shuffleTick, setShuffleTick] = useState(0);
  const [groupInput, setGroupInput] = useState(String(groupValue));
  const [synced, setSynced] = useState({ value: groupValue, classId: activeClass.id });
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the number box in sync when the value changes elsewhere (buttons,
  // chips, switching class); a new class also starts with an empty draft.
  if (groupValue !== synced.value || activeClass.id !== synced.classId) {
    if (activeClass.id !== synced.classId) setDraft('');
    setSynced({ value: groupValue, classId: activeClass.id });
    setGroupInput(String(groupValue));
  }

  const count = participants.length;
  const limits = { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS };
  const validation = validateGroupSetup(count, groupMode, groupValue, limits);
  const groupCount = groupCountFor(count, groupMode, groupValue);
  const sizes = useMemo(
    () => (validation.ok && groupCount >= 1 ? groupSizes(count, groupCount) : []),
    [validation.ok, count, groupCount],
  );

  // -------------------------------------------------------------------------
  // Classes (periods)
  // -------------------------------------------------------------------------

  function addClass() {
    const created = newClass(nextClassName(classes));
    created.groupMode = groupMode;
    created.groupValue = groupValue;
    onClassesChange([...classes, created]);
    onSelectClass(created.id);
    toast(`Added ${created.name}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function renameClass(id: string, name: string) {
    onClassesChange(classes.map((c) => (c.id === id ? { ...c, name } : c)));
  }

  function deleteClass(id: string) {
    if (classes.length <= 1) return;
    const before = classes;
    const index = classes.findIndex((c) => c.id === id);
    const removed = classes[index];
    const rest = classes.filter((c) => c.id !== id);
    onClassesChange(rest);
    onSelectClass(rest[Math.max(0, index - 1)].id);
    toast(`Deleted ${removed.name}`, {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          onClassesChange(before);
          onSelectClass(id);
        },
      },
    });
  }

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
    onGroupSettingChange(groupMode, next);
    setGroupInput(String(next));
  }

  function handleGroupInput(value: string) {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 2);
    setGroupInput(digits);
    const n = parseInt(digits, 10);
    const next = Number.isFinite(n) && n >= 1 ? n : 0;
    setSynced({ value: next, classId: activeClass.id }); // don't overwrite what the user is typing
    onGroupSettingChange(groupMode, next);
  }

  function setMode(mode: GroupMode) {
    if (mode === groupMode) return;
    // Convert the current setting so the groups stay about the same.
    let next = groupValue;
    if (count >= 2 && groupValue >= 1) {
      next = mode === 'size' ? Math.max(1, Math.ceil(count / groupValue)) : groupCountFor(count, 'size', groupValue);
    }
    onGroupSettingChange(mode, Math.max(1, Math.min(MAX_PARTICIPANTS, next || 2)));
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
  const quickPicks = [2, 3, 4, 5, 6];
  const isSize = groupMode === 'size';

  return (
    <main className="setup screen-enter">
      <header className="setup-header">
        <Logo />
        {lastResult && (
          <button className="btn btn-ghost" onClick={onShowLastResult} data-testid="last-results">
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
      </section>

      <ClassTabs
        classes={classes}
        activeId={activeClass.id}
        onSelect={onSelectClass}
        onAdd={addClass}
        onRename={renameClass}
        onDelete={deleteClass}
      />

      <div className="setup-grid">
        <section className="card setup-people" aria-labelledby="people-title">
          <div className="card-head">
            <h2 id="people-title">Who's racing?</h2>
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
              placeholder={'Type a name and press Enter\nor paste a list (one per line)'}
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

          {count === 0 ? (
            <div className="empty-state">
              <div className="empty-marbles" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <MarbleSwatch key={i} colorIndex={i * 3} size={i === 2 ? 34 : 24} />
                ))}
              </div>
              <button className="btn btn-secondary" onClick={() => addNames(SAMPLE_NAMES)} data-testid="sample-names">
                <SparkIcon size={16} /> Use sample names
              </button>
            </div>
          ) : (
            <>
              <div className="list-toolbar">
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
            <h2 id="groups-title">{isSize ? 'People per group' : 'How many groups?'}</h2>

            <div className="mode-toggle" role="radiogroup" aria-label="Group by">
              <button
                role="radio"
                aria-checked={!isSize}
                className={!isSize ? 'active' : ''}
                onClick={() => setMode('groups')}
                data-testid="mode-groups"
              >
                Number of groups
              </button>
              <button
                role="radio"
                aria-checked={isSize}
                className={isSize ? 'active' : ''}
                onClick={() => setMode('size')}
                data-testid="mode-size"
              >
                People per group
              </button>
            </div>

            <div className="stepper">
              <button
                className="stepper-btn"
                onClick={() => setGroups(groupValue - 1)}
                disabled={groupValue <= 1}
                aria-label={isSize ? 'Fewer people per group' : 'Fewer groups'}
                data-testid="groups-minus"
              >
                <MinusIcon />
              </button>
              <input
                className="stepper-value"
                inputMode="numeric"
                aria-label={isSize ? 'People per group' : 'Number of groups'}
                value={groupInput}
                onChange={(e) => handleGroupInput(e.target.value)}
                onBlur={() => {
                  if (!groupInput || groupValue < 1) setGroups(isSize ? 2 : 1);
                }}
                data-testid="group-count"
              />
              <button
                className="stepper-btn"
                onClick={() => setGroups(groupValue + 1)}
                disabled={groupValue >= groupPickerMax}
                aria-label={isSize ? 'More people per group' : 'More groups'}
                data-testid="groups-plus"
              >
                <PlusIcon />
              </button>
            </div>

            <div className="quick-picks" role="group" aria-label="Quick group counts">
              {quickPicks.map((n) => (
                <button
                  key={n}
                  className={`chip${n === groupValue ? ' active' : ''}`}
                  onClick={() => setGroups(n)}
                  disabled={count > 0 && n > count}
                >
                  {n}
                </button>
              ))}
            </div>

            {sizes.length > 0 ? (
              <div className="group-preview" data-testid="group-preview">
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
              </div>
            ) : null}
          </section>

          <div className="setup-cta">
            <button className="btn btn-primary btn-lg start-btn" onClick={onStart} disabled={!validation.ok} data-testid="start-race">
              <PlayIcon size={18} /> Start the race
            </button>
            <p className={`cta-note${validation.ok ? '' : ' warn'}`} role="status" data-testid="setup-message">
              {validation.ok ? '' : validation.message}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
