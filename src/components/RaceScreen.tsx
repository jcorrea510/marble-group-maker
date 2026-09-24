import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RaceConfig } from '../App';
import { groupColor } from '../game/colors';
import { RaceController, type HudState } from '../game/raceController';
import { generateTrack } from '../game/track/generator';
import type { RaceResult } from '../game/types';
import { Logo } from './Logo';
import { MarbleSwatch } from './MarbleSwatch';
import { ArrowLeftIcon, CheckIcon, ForwardIcon, FullscreenIcon, SoundOffIcon, SoundOnIcon } from './Icons';
import './RaceScreen.css';

interface Props {
  config: RaceConfig;
  muted: boolean;
  onToggleMute: () => void;
  onComplete: (result: RaceResult) => void;
  onExit: () => void;
}

const ROW_HEIGHT = 40;

function debugSpeedFromUrl(): number {
  const value = Number(new URLSearchParams(window.location.search).get('speed'));
  return Number.isFinite(value) && value > 0 ? Math.min(8, value) : 1;
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RaceScreen({ config, muted, onToggleMute, onComplete, onExit }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<RaceController | null>(null);
  const completeRef = useRef(onComplete);
  const [hud, setHud] = useState<HudState | null>(null);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  // A brand-new course for this race (the seed is random per race).
  const track = useMemo(() => generateTrack(config.seed, config.startOrder.length), [config.seed, config.startOrder.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const controller = new RaceController(canvas, {
      track,
      participants: config.startOrder,
      seed: config.seed,
      raceNumber: config.raceNumber,
      groupCount: config.groupCount,
      debugSpeed: debugSpeedFromUrl(),
      onHud: setHud,
      onComplete: (result) => completeRef.current(result),
    });
    controllerRef.current = controller;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      controller.resize(rect.width, rect.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    controller.start();
    return () => {
      observer.disconnect();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [track, config]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (controllerRef.current?.currentPhase === 'intro') {
          e.preventDefault();
          controllerRef.current.skipIntro();
        }
      } else if (e.key === 'Escape') {
        controllerRef.current?.setFollow(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  const phase = hud?.phase ?? 'intro';
  const total = config.startOrder.length;
  const winner = hud?.standings.find((s) => s.rank === 1 && s.finished);
  const courseRoute = useMemo(
    () => track.sections.filter((s) => s.type !== 'start').map((s) => s.label),
    [track],
  );

  const statusLabel =
    phase === 'intro' ? 'Course preview' : phase === 'countdown' ? 'Get ready' : phase === 'racing' ? 'Live' : 'Finished';

  return (
    <main className="race" data-testid="race-screen" data-phase={phase}>
      <header className="race-top">
        <div className="race-top-left">
          <button className="icon-btn" onClick={onExit} aria-label="Back to setup" title="Back to setup">
            <ArrowLeftIcon />
          </button>
          <Logo compact />
        </div>

        <div className="race-top-center">
          <span className={`status-pill status-${phase}`}>
            <i />
            {statusLabel}
          </span>
          <span className="race-timer" data-testid="race-timer">
            {formatTime(hud?.raceTimeMs ?? 0)}
          </span>
          <span className="race-finished-count">
            <CheckIcon size={14} /> {hud?.finished ?? 0}/{total}
          </span>
        </div>

        <div className="race-top-right">
          <span className="race-course">
            Race {config.raceNumber} · Course <b>{track.code}</b>
          </span>
          <button
            className="icon-btn"
            onClick={onToggleMute}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound off' : 'Sound on'}
          >
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </button>
          {canFullscreen && (
            <button className="icon-btn" onClick={toggleFullscreen} aria-label="Toggle fullscreen" title="Fullscreen (great for projectors)">
              <FullscreenIcon />
            </button>
          )}
        </div>
      </header>

      <div className="race-body">
        <div className={`race-stage${hud?.photoFinish ? ' slowmo' : ''}`} ref={stageRef}>
          <canvas ref={canvasRef} className="race-canvas" data-testid="race-canvas" />
          <div className="race-vignette" aria-hidden="true" />

          {phase === 'intro' && (
            <div className="intro-card" data-testid="intro-card">
              <div className="intro-eyebrow">New course generated</div>
              <div className="intro-title">
                Course <span>{track.code}</span>
              </div>
              <ol className="intro-route">
                {courseRoute.map((label, i) => (
                  <li key={i} style={{ animationDelay: `${i * 70}ms` }}>
                    {label}
                  </li>
                ))}
              </ol>
              <button className="btn btn-secondary intro-skip" onClick={() => controllerRef.current?.skipIntro()}>
                Skip preview <ForwardIcon size={16} />
              </button>
            </div>
          )}

          {phase === 'countdown' && hud?.countdown && (
            <div className="countdown" aria-live="assertive" data-testid="countdown">
              <span key={hud.countdown} className="countdown-num">
                {hud.countdown}
              </span>
            </div>
          )}
          {hud?.showGo && (
            <div className="countdown" aria-live="assertive">
              <span className="countdown-num go">GO!</span>
            </div>
          )}

          {hud?.photoFinish && (
            <div className="photo-finish" aria-live="polite">
              Photo finish!
            </div>
          )}

          {phase === 'finished' && (
            <div className="finish-banner" data-testid="finish-banner">
              <div className="finish-kicker">Race complete</div>
              {winner && (
                <div className="finish-winner">
                  <MarbleSwatch colorIndex={winner.colorIndex} size={30} />
                  <span>{winner.name} wins!</span>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="race-board" aria-label="Live standings">
          <div className="board-head">
            <span className="board-title">Standings</span>
          </div>
          <div className="board-scroll">
            <ol className="board-list" style={{ height: total * ROW_HEIGHT }} data-testid="leaderboard">
              {(hud?.standings ?? []).map((row) => {
                const followed = hud?.followIndex === row.index;
                const style = {
                  transform: `translateY(${(row.rank - 1) * ROW_HEIGHT}px)`,
                  '--progress': `${Math.round(row.progress * 100)}%`,
                  '--g': row.group !== null ? groupColor(row.group) : 'transparent',
                } as CSSProperties;
                return (
                  <li
                    key={row.id}
                    className={`board-row${row.finished ? ' done' : ''}${followed ? ' followed' : ''}${row.rank <= 3 && row.finished ? ' board-top3' : ''}`}
                    style={style}
                  >
                    <button onClick={() => controllerRef.current?.setFollow(row.index)} aria-pressed={followed}>
                      <span className="board-rank">{row.rank}</span>
                      <MarbleSwatch colorIndex={row.colorIndex} size={18} />
                      <span className="board-name">{row.name}</span>
                      {row.finished ? (
                        <span className="board-meta">
                          <span className="board-group">G{(row.group ?? 0) + 1}</span>
                          <span className="board-time">{formatTime(row.finishTimeMs ?? 0)}</span>
                        </span>
                      ) : (
                        <span className="board-progress" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}
