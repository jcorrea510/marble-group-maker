import { audio } from './audio';
import { marbleStyle } from './colors';
import { groupIndexForPosition } from './grouping';
import { RaceSimulation, STEP_MS, type MarbleState, type SimEvent } from './physics/raceSimulation';
import { RaceRenderer } from './render/renderer';
import { seedToCode } from './rng';
import type { Track } from './track/types';
import type { Participant, RaceResult } from './types';

/**
 * ---------------------------------------------------------------------------
 * RACE CONTROLLER
 * ---------------------------------------------------------------------------
 * Runs the animation loop for one race:
 *
 *   intro (camera flies up the new course) → countdown 3-2-1-GO
 *   → racing → finished (celebration) → results
 *
 * The physics always advances in fixed 1/60 s steps. To keep races close
 * to 20 seconds, the loop may play those steps slightly faster or slower
 * (0.85×–1.45×). That's like fast-forwarding a video: it never changes what
 * happens in the race, only how quickly you watch it.
 */

export const TARGET_RACE_WALL_SECONDS = 20;
const INTRO_SECONDS = 3.2;
const COUNTDOWN_STEP = 0.8;
const CELEBRATION_SECONDS = 2.4;

export type RacePhase = 'intro' | 'countdown' | 'racing' | 'finished';

export interface StandingRow {
  index: number;
  id: string;
  name: string;
  colorIndex: number;
  rank: number;
  finished: boolean;
  finishTimeMs: number | null;
  progress: number;
  group: number | null;
}

export interface HudState {
  phase: RacePhase;
  /** 3, 2, 1, 0 (= GO) during the countdown, otherwise null. */
  countdown: number | null;
  raceTimeMs: number;
  finished: number;
  total: number;
  standings: StandingRow[];
  followIndex: number | null;
  showGo: boolean;
  /** True during the brief slow-motion "photo finish". */
  photoFinish: boolean;
}

export interface RaceControllerOptions {
  track: Track;
  participants: Participant[];
  seed: number;
  raceNumber: number;
  groupCount: number;
  /** Extra playback multiplier (e.g. `?speed=4` for testing). */
  debugSpeed?: number;
  onHud: (hud: HudState) => void;
  onComplete: (result: RaceResult) => void;
}

export class RaceController {
  readonly sim: RaceSimulation;
  private readonly renderer: RaceRenderer;
  private readonly opts: RaceControllerOptions;
  private phase: RacePhase = 'intro';
  private phaseTime = 0;
  private clock = 0;
  private accumulator = 0;
  private speed = 1;
  private raceWall = 0;
  private gateOpenFor: number | null = null;
  private followIndex: number | null = null;
  private lastCountdown: number | null = null;
  private hudTimer = 0;
  private rafId = 0;
  private lastFrame = 0;
  private prevPositions: Float64Array;
  private destroyed = false;
  private completed = false;
  private readonly reducedMotion: boolean;
  private readonly expected: { progress: number; time: number }[];
  private cssW = 0;
  private slowmoLeft = 0;
  private slowmoUsed = false;
  /** Race order as shown on screen (see `updateStandings`). */
  private standings: MarbleState[] = [];

  constructor(canvas: HTMLCanvasElement, opts: RaceControllerOptions) {
    this.opts = opts;
    this.sim = new RaceSimulation(opts.track, opts.participants, opts.seed);
    this.renderer = new RaceRenderer(canvas, opts.track, this.sim);
    this.prevPositions = new Float64Array(this.sim.marbles.length * 2);
    this.capturePositions();
    this.reducedMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    this.expected = this.buildExpectedCurve();
    this.renderer.camera.jumpTo(opts.track.finishY);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.frame(dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.sim.destroy();
  }

  resize(cssW: number, cssH: number) {
    this.cssW = cssW;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(cssW, cssH, dpr);
  }

  skipIntro() {
    if (this.phase === 'intro') this.setPhase('countdown');
  }

  setFollow(index: number | null) {
    this.followIndex = this.followIndex === index ? null : index;
    this.emitHud();
  }

  get currentPhase() {
    return this.phase;
  }

  get playbackSpeed() {
    return this.speed;
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  private setPhase(phase: RacePhase) {
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'racing') {
      this.sim.start();
      this.gateOpenFor = 0;
      this.renderer.camera.addShake(0.25);
    }
    this.emitHud();
  }

  private frame(dt: number) {
    if (this.cssW === 0) return;
    this.clock += dt;
    this.phaseTime += dt;
    const debug = this.opts.debugSpeed ?? 1;

    switch (this.phase) {
      case 'intro': {
        this.advancePhysics(dt * debug);
        const t = Math.min(1, this.phaseTime / (INTRO_SECONDS / debug));
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const from = this.opts.track.finishY;
        const to = this.startViewY();
        this.renderer.camera.jumpTo(from + (to - from) * eased);
        if (t >= 1) this.setPhase('countdown');
        break;
      }
      case 'countdown': {
        this.advancePhysics(dt * debug);
        const step = COUNTDOWN_STEP / debug;
        const n = 3 - Math.floor(this.phaseTime / step);
        if (n !== this.lastCountdown && n >= 1) {
          this.lastCountdown = n;
          audio.countdown();
          this.emitHud();
        }
        this.renderer.camera.follow(this.startViewY(), dt, 6);
        if (this.phaseTime >= step * 3) {
          audio.go();
          this.setPhase('racing');
        }
        break;
      }
      case 'racing': {
        this.raceWall += dt;
        if (this.gateOpenFor !== null) this.gateOpenFor += dt;
        this.updateSpeed(dt);
        this.checkPhotoFinish(dt);
        const playback = this.slowmoLeft > 0 ? 0.4 : this.speed;
        this.advancePhysics(dt * playback * debug);
        this.updateCamera(dt);
        if (this.sim.isComplete) {
          this.setPhase('finished');
          audio.fanfare();
          this.celebrate();
        }
        break;
      }
      case 'finished': {
        if (this.gateOpenFor !== null) this.gateOpenFor += dt;
        this.advancePhysics(dt);
        this.renderer.camera.follow(this.opts.track.finishY + 60, dt, 2.5);
        if (this.phaseTime >= CELEBRATION_SECONDS / debug && !this.completed) {
          this.completed = true;
          this.opts.onComplete(this.buildResult());
        }
        break;
      }
    }

    this.handleEvents();
    this.updateStandings();
    this.renderer.render({
      dt,
      clock: this.clock,
      alpha: Math.min(1, this.accumulator / STEP_MS),
      gateOpenFor: this.gateOpenFor,
      followIndex: this.followIndex,
      standings: this.standings,
      prevPositions: this.prevPositions,
      reducedMotion: this.reducedMotion,
    });

    this.hudTimer += dt;
    if (this.hudTimer > 0.12) {
      this.hudTimer = 0;
      this.emitHud();
    }
    this.publishDebug();
  }

  private advancePhysics(dtSeconds: number) {
    this.accumulator += dtSeconds * 1000;
    let steps = 0;
    const maxSteps = 12;
    while (this.accumulator >= STEP_MS && steps < maxSteps) {
      this.capturePositions();
      this.sim.step();
      this.accumulator -= STEP_MS;
      steps++;
    }
    if (steps === maxSteps) this.accumulator = 0;
  }

  private capturePositions() {
    for (const m of this.sim.marbles) {
      this.prevPositions[m.index * 2] = m.body.position.x;
      this.prevPositions[m.index * 2 + 1] = m.body.position.y;
    }
  }

  // -------------------------------------------------------------------------
  // Pacing (≈20 s races)
  // -------------------------------------------------------------------------

  /** Expected physics time (s) for a typical marble to reach each progress value. */
  private buildExpectedCurve() {
    const { sections } = this.opts.track;
    const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
    const curve: { progress: number; time: number }[] = [{ progress: 0, time: 0 }];
    let w = 0;
    let t = 0;
    for (const s of sections) {
      w += s.weight;
      t += s.estimate;
      curve.push({ progress: w / totalWeight, time: t });
    }
    return curve;
  }

  private expectedTime(progress: number): number {
    const c = this.expected;
    for (let i = 1; i < c.length; i++) {
      if (progress <= c[i].progress) {
        const a = c[i - 1];
        const b = c[i];
        const f = (progress - a.progress) / Math.max(1e-6, b.progress - a.progress);
        return a.time + (b.time - a.time) * f;
      }
    }
    return c[c.length - 1].time;
  }

  private updateSpeed(dt: number) {
    const marbles = this.sim.marbles;
    const running = marbles.filter((m) => !m.finished);
    if (running.length === 0) return;
    const tau = this.sim.raceTimeMs / 1000;
    const progresses = marbles.map((m) => (m.finished ? 1 : m.progress)).sort((a, b) => a - b);
    const median = progresses[Math.floor(progresses.length / 2)];
    const tail = Math.min(...running.map((m) => m.progress));
    const total = this.expectedTime(1);

    // How fast is this race compared to the course estimate?
    const expectedNow = this.expectedTime(median);
    const pace = tau > 2 && expectedNow > 0.5 ? Math.min(1.7, Math.max(0.6, tau / expectedNow)) : 1;
    // Stragglers are typically a bit slower than the median marble.
    const remainingPhysics = Math.max(0.3, (total - this.expectedTime(tail)) * pace * 1.12);
    const remainingWall = TARGET_RACE_WALL_SECONDS - this.raceWall;

    // Once most of the field is home, the last few stragglers may be shown in
    // fast-forward (up to 2.2x) so nobody waits long for the final marble.
    const finishedShare = this.sim.finishedCount / marbles.length;
    const maxSpeed = finishedShare >= 0.75 ? 2.2 : 1.45;
    let desired = remainingWall > 1.2 ? remainingPhysics / remainingWall : maxSpeed;
    desired = Math.min(maxSpeed, Math.max(0.85, desired));
    if (this.raceWall < 1.2) desired = 1;
    this.speed += (desired - this.speed) * Math.min(1, dt * 0.9);
  }

  /**
   * If the two leaders reach the finish neck and neck, show it in slow
   * motion once. (Only the playback slows down; the physics is unchanged.)
   */
  private checkPhotoFinish(dt: number) {
    if (this.slowmoLeft > 0) {
      this.slowmoLeft -= dt;
      if (this.slowmoLeft <= 0) this.emitHud();
      return;
    }
    if (this.slowmoUsed || this.sim.finishedCount > 0 || this.reducedMotion) return;
    const [a, b] = this.sim.standings();
    if (!a || !b) return;
    const finishY = this.opts.track.finishY;
    const ay = a.body.position.y;
    const by = b.body.position.y;
    if (ay > finishY - 130 && ay < finishY && Math.abs(ay - by) < 40 && Math.abs(a.body.position.x - b.body.position.x) < 180) {
      this.slowmoUsed = true;
      this.slowmoLeft = 1.1;
      this.emitHud();
    }
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  private startViewY(): number {
    const cam = this.renderer.camera;
    return this.opts.track.gateY - cam.worldViewH * 0.18;
  }

  private updateCamera(dt: number) {
    const cam = this.renderer.camera;
    const viewH = cam.worldViewH;
    if (this.followIndex !== null) {
      const m = this.sim.marbles[this.followIndex];
      cam.follow(m.body.position.y, dt, 4);
      return;
    }
    const standings = this.sim.standings();
    const running = standings.filter((m) => !m.finished);
    if (running.length === 0) {
      cam.follow(this.opts.track.finishY, dt);
      return;
    }
    const leader = running[0].body;
    // Look a little ahead of where the leader is heading.
    const leaderY = leader.position.y + Math.max(-40, Math.min(160, leader.velocity.y * 10));
    const chaser = running[Math.min(running.length - 1, 4)];
    const chaserY = chaser.body.position.y;
    let target: number;
    if (leaderY - chaserY < viewH * 0.55) {
      // Keep the lead pack together in view (leader slightly below centre).
      target = (leaderY + chaserY) / 2 + viewH * 0.08;
    } else {
      target = leaderY - viewH * 0.08;
    }
    // Once marbles are finishing, stay near the finish line.
    if (this.sim.finishedCount > 0) target = Math.max(target, Math.min(leaderY, this.opts.track.finishY - viewH * 0.25));
    cam.follow(target, dt, 3.6);
    // Never let the leader slip off the bottom of the screen.
    cam.keepAbove(leader.position.y, 0.8);
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private handleEvents() {
    const events: SimEvent[] = this.sim.drainEvents();
    const cam = this.renderer.camera;
    const p = this.renderer.particles;
    const view = { top: cam.top - 100, bottom: cam.bottom + 100 };
    for (const e of events) {
      if (e.type === 'hit') {
        if (e.y < view.top || e.y > view.bottom) continue;
        const color = marbleStyle(this.sim.marbles[e.marble].participant.colorIndex).base;
        if (e.kind === 'bumper') {
          p.ring(e.x, e.y, '#ffb347', 14);
          p.sparks(e.x, e.y, '#ffd08a', 6, 260);
          cam.addShake(0.07);
          audio.hit(e.strength, 'bumper');
        } else if (e.kind === 'trampoline') {
          p.ring(e.x, e.y, '#fb7185', 12);
          p.sparks(e.x, e.y, '#ffc2cc', 5, 240);
          cam.addShake(0.05);
          audio.hit(e.strength, 'bumper');
        } else if (e.kind === 'pendulum') {
          p.sparks(e.x, e.y, '#ff9cf0', 6, 220);
          cam.addShake(0.08);
          audio.hit(e.strength, 'other');
        } else if (e.kind === 'marble') {
          if (e.strength > 4) p.sparks(e.x, e.y, '#ffffff', Math.min(6, Math.floor(e.strength / 1.5)), 170);
          if (e.strength > 9) cam.addShake(0.04);
          audio.hit(e.strength, 'marble');
        } else {
          if (e.strength > 5) p.sparks(e.x, e.y, color, Math.min(5, Math.floor(e.strength / 2)), 150);
          if (e.kind === 'spinner' && e.strength > 6) cam.addShake(0.03);
          audio.hit(e.strength, 'other');
        }
      } else if (e.type === 'finish') {
        const m = this.sim.marbles[e.marble];
        const style = marbleStyle(m.participant.colorIndex);
        const x = m.body.position.x;
        const y = this.opts.track.finishY;
        p.confetti(x, y, [style.base, style.swirl, '#ffffff'], e.position === 1 ? 70 : 14, e.position === 1 ? 1.2 : 0.6);
        p.floatingText(x, y - 30, ordinal(e.position), e.position <= 3 ? '#ffc53d' : '#ffffff');
        audio.finish(e.position);
        if (e.position === 1) {
          cam.addShake(0.35);
          this.renderer.flashFinish();
        }
      }
    }
  }

  private celebrate() {
    const p = this.renderer.particles;
    const { track } = this.opts;
    const colors = this.sim.finishingOrder.slice(0, 6).map((m) => marbleStyle(m.participant.colorIndex).base);
    for (let i = 0; i < 5; i++) {
      p.confetti(track.innerLeft + ((track.innerRight - track.innerLeft) * (i + 0.5)) / 5, track.finishY + 40, colors, 26, 1.1);
    }
  }

  // -------------------------------------------------------------------------
  // HUD + results
  // -------------------------------------------------------------------------

  /**
   * Finished marbles keep their finishing order. Running marbles are sorted
   * by progress, but two neighbours only swap when one is clearly ahead, so
   * the leaderboard doesn't flicker when marbles are side by side.
   */
  private updateStandings() {
    const { sim } = this;
    if (!sim.started) {
      this.standings = sim.marbles.slice(); // starting grid order
      return;
    }
    const running = this.standings.filter((m) => !m.finished);
    for (const m of sim.marbles) if (!m.finished && !running.includes(m)) running.push(m);
    for (let pass = 0; pass < running.length; pass++) {
      let swapped = false;
      for (let i = 0; i + 1 < running.length; i++) {
        if (running[i + 1].progress > running[i].progress + 0.003) {
          [running[i], running[i + 1]] = [running[i + 1], running[i]];
          swapped = true;
        }
      }
      if (!swapped) break;
    }
    this.standings = [...sim.finishingOrder, ...running];
  }

  private emitHud() {
    const { sim } = this;
    const total = sim.marbles.length;
    if (this.standings.length !== sim.marbles.length) this.updateStandings();
    const standings = this.standings.map<StandingRow>((m, i) => ({
      index: m.index,
      id: m.participant.id,
      name: m.participant.name,
      colorIndex: m.participant.colorIndex,
      rank: i + 1,
      finished: m.finished,
      finishTimeMs: m.finishTimeMs,
      progress: m.progress,
      group: m.finished && m.position !== null ? groupIndexForPosition(m.position - 1, total, this.opts.groupCount) : null,
    }));
    const countdown =
      this.phase === 'countdown'
        ? Math.max(1, 3 - Math.floor(this.phaseTime / (COUNTDOWN_STEP / (this.opts.debugSpeed ?? 1))))
        : null;
    this.opts.onHud({
      phase: this.phase,
      countdown,
      raceTimeMs: sim.raceTimeMs,
      finished: sim.finishedCount,
      total,
      standings,
      followIndex: this.followIndex,
      showGo: this.phase === 'racing' && this.phaseTime < 0.8,
      photoFinish: this.slowmoLeft > 0,
    });
  }

  private buildResult(): RaceResult {
    const order = this.sim.finishingOrder.map((m) => ({
      participantId: m.participant.id,
      name: m.participant.name,
      colorIndex: m.participant.colorIndex,
      position: m.position!,
      finishTimeMs: Math.round(m.finishTimeMs ?? 0),
      rankedByDistance: m.rankedByDistance,
    }));
    return {
      raceNumber: this.opts.raceNumber,
      seed: this.opts.seed,
      courseCode: seedToCode(this.opts.track.seed),
      groupCount: this.opts.groupCount,
      order,
      durationMs: Math.round(order.length ? order[order.length - 1].finishTimeMs : 0),
      finishedAt: Date.now(),
    };
  }

  /** Exposes race state for automated browser tests (read-only). */
  private publishDebug() {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __marbleRace?: unknown };
    const sim = this.sim;
    w.__marbleRace = {
      phase: this.phase,
      seed: this.opts.seed,
      courseCode: seedToCode(this.opts.track.seed),
      sectionTypes: this.opts.track.sections.map((s) => s.type),
      trackHeight: this.opts.track.height,
      raceTimeMs: sim.raceTimeMs,
      raceWallSeconds: this.raceWall,
      playbackSpeed: this.speed,
      finished: sim.finishedCount,
      stats: { ...sim.stats },
      positions: sim.marbles.map((m) => ({ name: m.participant.name, x: m.body.position.x, y: m.body.position.y })),
      finishOrder: sim.finishingOrder.map((m) => m.participant.name),
    };
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
