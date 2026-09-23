import type { CSSProperties } from 'react';
import { groupColor } from '../game/colors';
import { splitIntoGroups } from '../game/grouping';
import type { FinishEntry, RaceResult } from '../game/types';
import { Logo } from './Logo';
import { MarbleSwatch } from './MarbleSwatch';
import type { ToastOptions } from './Toasts';
import { CopyIcon, EditIcon, RepeatIcon, TrophyIcon } from './Icons';
import './ResultsScreen.css';

interface Props {
  result: RaceResult;
  onRaceAgain: () => void;
  onEdit: () => void;
  toast: (message: string, options?: ToastOptions) => void;
}

function formatTime(ms: number) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function placeLabel(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function groupsAsText(result: RaceResult): string {
  const groups = splitIntoGroups(result.order, result.groupCount);
  const lines = [`Marble Group Maker – Race ${result.raceNumber} (course ${result.courseCode})`, ''];
  groups.forEach((members, g) => {
    lines.push(`GROUP ${g + 1}`);
    for (const m of members) lines.push(`${m.position}. ${m.name}`);
    lines.push('');
  });
  return lines.join('\n').trim() + '\n';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function ResultsScreen({ result, onRaceAgain, onEdit, toast }: Props) {
  const groups = splitIntoGroups(result.order, result.groupCount);
  const groupOf = new Map<string, number>();
  groups.forEach((members, g) => members.forEach((m) => groupOf.set(m.participantId, g)));
  const podium = result.order.slice(0, 3);
  const winner = result.order[0];
  const byDistance = result.order.filter((e) => e.rankedByDistance).length;

  async function handleCopy() {
    const ok = await copyText(groupsAsText(result));
    toast(ok ? 'Groups copied to clipboard' : "Couldn't copy – your browser blocked it");
  }

  return (
    <main className="results screen-enter" data-testid="results-screen">
      <header className="results-header">
        <Logo />
        <div className="results-header-actions">
          <button className="btn btn-ghost" onClick={handleCopy} data-testid="copy-groups">
            <CopyIcon size={16} />
            <span>
              Copy<span className="hide-sm"> groups</span>
            </span>
          </button>
        </div>
      </header>

      <section className="results-hero">
        <div className="hero-text">
          <div className="eyebrow">
            Race {result.raceNumber} · Course {result.courseCode} · {formatTime(result.durationMs)}
          </div>
          <h1>
            <span className="grad-text">{winner.name}</span> takes the win!
          </h1>
          <p>
            {result.order.length} marbles finished. The finishing order made {result.groupCount}{' '}
            {result.groupCount === 1 ? 'group' : 'groups'}: the first{' '}
            {groups[0].length === 1 ? 'finisher goes' : `${groups[0].length} finishers go`} to Group 1, the next to Group 2,
            and so on.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={onRaceAgain} data-testid="race-again">
              <RepeatIcon size={18} /> Race again
            </button>
            <button className="btn btn-secondary btn-lg" onClick={onEdit} data-testid="edit-participants">
              <EditIcon size={18} /> Edit participants
            </button>
          </div>
          <p className="hero-footnote">Race again keeps everyone and the group count, builds a brand-new course and reshuffles the start.</p>
        </div>

        <div className="podium" aria-label="Top three">
          {[1, 0, 2].map((i) => {
            const entry = podium[i];
            if (!entry) return <div key={i} className="podium-slot empty" />;
            return (
              <div key={i} className={`podium-slot place-${i + 1}`} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                <MarbleSwatch colorIndex={entry.colorIndex} size={i === 0 ? 54 : 42} />
                <div className="podium-name" title={entry.name}>
                  {entry.name}
                </div>
                <div className="podium-block">
                  {i === 0 ? <TrophyIcon size={20} /> : null}
                  <span>{placeLabel(i + 1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {byDistance > 0 && (
        <p className="results-note">
          The race reached its time limit, so the last {byDistance} {byDistance === 1 ? 'marble was' : 'marbles were'} placed
          by how far along the course they got.
        </p>
      )}

      <div className="results-grid">
        <section aria-labelledby="groups-heading" className="groups-section">
          <h2 id="groups-heading" className="section-title">
            Your groups
          </h2>
          <div className="group-cards" data-testid="group-cards">
            {groups.map((members, g) => (
              <GroupCard key={g} index={g} members={members} />
            ))}
          </div>
        </section>

        <section aria-labelledby="order-heading" className="order-section">
          <h2 id="order-heading" className="section-title">
            Finishing order
          </h2>
          <ol className="order-list card" data-testid="finish-order">
            {result.order.map((entry) => {
              const g = groupOf.get(entry.participantId) ?? 0;
              const gap = entry.finishTimeMs - winner.finishTimeMs;
              return (
                <li key={entry.participantId} className="order-row" style={{ '--g': groupColor(g) } as CSSProperties}>
                  <span className={`order-pos${entry.position <= 3 ? ' top' : ''}`}>{entry.position}</span>
                  <MarbleSwatch colorIndex={entry.colorIndex} />
                  <span className="order-name">{entry.name}</span>
                  <span className="order-time">{entry.position === 1 ? formatTime(entry.finishTimeMs) : `+${(gap / 1000).toFixed(2)}s`}</span>
                  <span className="order-group">G{g + 1}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </main>
  );
}

function GroupCard({ index, members }: { index: number; members: FinishEntry[] }) {
  const color = groupColor(index);
  const first = members[0]?.position;
  const last = members[members.length - 1]?.position;
  return (
    <article className="group-card" style={{ '--g': color, animationDelay: `${0.1 + index * 0.07}s` } as CSSProperties} data-testid="group-card">
      <header>
        <h3>Group {index + 1}</h3>
        <span className="group-card-range">
          {members.length === 1 ? `${placeLabel(first)} place` : `Places ${first}–${last}`} · {members.length}{' '}
          {members.length === 1 ? 'person' : 'people'}
        </span>
      </header>
      <ol>
        {members.map((m) => (
          <li key={m.participantId}>
            <span className="gc-pos">{m.position}</span>
            <MarbleSwatch colorIndex={m.colorIndex} size={20} />
            <span className="gc-name">{m.name}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}
