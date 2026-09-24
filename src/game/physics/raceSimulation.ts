import Matter from 'matter-js';
import { Rng } from '../rng';
import { pointInPolygon } from '../track/geometry';
import { ProgressMap } from '../track/progress';
import type { PendulumItem, SliderItem, SpinnerItem, Track, TrackItem, ZoneItem } from '../track/types';
import type { Participant } from '../types';
import { pendulumAngle, pendulumBob, sliderOffset, spinnerAngle } from './kinematics';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// Matter.js 0.20 accepts an `updateVelocity` flag that its type definitions
// don't know about yet. Passing `true` makes a moved static body behave like
// a moving object in collisions (so spinners actually bat marbles around).
const setAngleMoving = Body.setAngle as unknown as (body: Matter.Body, angle: number, updateVelocity: boolean) => void;
const setPositionMoving = Body.setPosition as unknown as (
  body: Matter.Body,
  position: Matter.Vector,
  updateVelocity: boolean,
) => void;

/**
 * ---------------------------------------------------------------------------
 * RACE SIMULATION
 * ---------------------------------------------------------------------------
 * This is the real race. Every marble is a Matter.js rigid body; gravity,
 * collisions, bounces and friction decide what happens. Nothing about the
 * finishing order is decided in advance: a marble's position is recorded
 * at the exact moment it crosses the finish line.
 *
 * The simulation always advances in fixed 1/60 s steps. The screen can show
 * those steps a little faster or slower (to keep the race around 20
 * seconds), but that never changes the physics or the result.
 */

export const STEP_MS = 1000 / 60;
export const GRAVITY_SCALE = 0.0017;
/** Maximum marble speed (world units per 1/60 s step) – prevents tunnelling. */
const MAX_SPEED = 22;
const BASE_AIR = 0.008;
/** Safety net: after this much race time, remaining marbles are ranked by distance. */
export const MAX_RACE_MS = 75_000;

export type HitKind = 'marble' | 'bumper' | 'peg' | 'wall' | 'spinner' | 'slider' | 'pendulum' | 'trampoline';

export type SimEvent =
  | { type: 'hit'; kind: HitKind; x: number; y: number; strength: number; marble: number; other?: number; itemId?: number }
  | { type: 'finish'; marble: number; position: number }
  | { type: 'gate' };

export interface MarbleState {
  index: number;
  participant: Participant;
  body: Matter.Body;
  radius: number;
  finished: boolean;
  /** Race time (ms) when the marble crossed the finish line. */
  finishTimeMs: number | null;
  /** 1-based finishing position. */
  position: number | null;
  rankedByDistance: boolean;
  progress: number;
  inMud: boolean;
  /** Visual rolling angle (for the swirl inside the glass). */
  spin: number;
  spinRate: number;
  prevY: number;
  // Anti-stuck bookkeeping
  checkpoints: { x: number; y: number; progress: number }[];
  nudges: number;
  ghostSteps: number;
  /** y of the last point where the marble was touching something. */
  lastContactY: number;
  /** Longest distance fallen without touching anything (after the start). */
  maxFreeFall: number;
  /** Where that fall started and ended (x, y0, y1) – for diagnostics. */
  maxFreeFallAt: [number, number, number];
}

export interface SimStats {
  steps: number;
  marbleCollisions: number;
  obstacleCollisions: number;
  nudges: number;
  rescues: number;
  outOfBounds: number;
  /** Longest untouched fall of any marble in this race (world units). */
  maxFreeFall: number;
}

interface Kinematic {
  item: SpinnerItem | SliderItem | PendulumItem;
  body: Matter.Body;
}

const CATEGORY_MARBLE = 0x0001;
const CATEGORY_TRACK = 0x0002;

export class RaceSimulation {
  readonly engine: Matter.Engine;
  readonly track: Track;
  readonly marbles: MarbleState[];
  readonly stats: SimStats = {
    steps: 0,
    marbleCollisions: 0,
    obstacleCollisions: 0,
    nudges: 0,
    rescues: 0,
    outOfBounds: 0,
    maxFreeFall: 0,
  };
  /** Milliseconds since "GO!". */
  raceTimeMs = 0;
  /** Milliseconds since the simulation was created (moving parts use this). */
  worldTimeMs = 0;
  started = false;
  finishedCount = 0;
  /** Where the anti-stuck help had to step in (diagnostics for tests). */
  readonly nudgeLog: { x: number; y: number; rescue: boolean }[] = [];
  /** Effects the renderer can consume (drained every frame). */
  events: SimEvent[] = [];
  /** Last time (world ms) each bumper was hit – for flashing. */
  readonly bumperHits = new Map<number, number>();

  private readonly rng: Rng;
  private readonly progressMap: ProgressMap;
  private readonly kinematics: Kinematic[] = [];
  private readonly zones: ZoneItem[];
  private readonly gateBodies: Matter.Body[] = [];
  private readonly itemByBodyId = new Map<number, TrackItem>();
  private readonly marbleByBodyId = new Map<number, MarbleState>();
  private readonly pendingKicks: { marble: MarbleState; nx: number; ny: number; minSpeed: number }[] = [];
  private finishOrder: MarbleState[] = [];
  private readonly collisionHandler = (event: Matter.IEventCollision<Matter.Engine>) => this.onCollisionStart(event);
  private timedOut = false;

  /**
   * @param participants in starting-grid order (index 0 gets start slot 0).
   */
  constructor(track: Track, participants: Participant[], raceSeed: number) {
    this.track = track;
    this.rng = new Rng(raceSeed ^ 0x51ed27);
    this.progressMap = new ProgressMap(track);
    this.zones = track.items.filter((i): i is ZoneItem => i.kind === 'zone');

    this.engine = Engine.create({
      gravity: { x: 0, y: 1, scale: GRAVITY_SCALE },
      positionIterations: 10,
      velocityIterations: 8,
      enableSleeping: false,
    });

    this.buildTrackBodies();

    const r = track.marbleRadius;
    this.marbles = participants.map((participant, index) => {
      const slot = track.startSlots[index];
      // Marbles are smooth, frictionless gliders that don't rotate physically.
      // (Rolling polygons in Matter.js lose far too much energy; real marbles
      // have almost no rolling resistance.) The swirl drawn inside each marble
      // still rotates, driven by its velocity – see `spin` below.
      const body = Bodies.polygon(slot.x + this.rng.range(-1.5, 1.5), slot.y, 24, r, {
        label: 'marble',
        restitution: 0.38,
        friction: 0,
        frictionStatic: 0,
        frictionAir: BASE_AIR,
        density: 0.0025,
        slop: 0.02,
        collisionFilter: { category: CATEGORY_MARBLE, mask: CATEGORY_MARBLE | CATEGORY_TRACK },
      });
      Body.setInertia(body, Infinity);
      const state: MarbleState = {
        index,
        participant,
        body,
        radius: r,
        finished: false,
        finishTimeMs: null,
        position: null,
        rankedByDistance: false,
        progress: 0,
        inMud: false,
        spin: this.rng.range(0, Math.PI * 2),
        spinRate: 0,
        prevY: slot.y,
        checkpoints: [],
        nudges: 0,
        ghostSteps: 0,
        lastContactY: slot.y,
        maxFreeFall: 0,
        maxFreeFallAt: [slot.x, slot.y, slot.y],
      };
      this.marbleByBodyId.set(body.id, state);
      return state;
    });
    Composite.add(
      this.engine.world,
      this.marbles.map((m) => m.body),
    );

    Events.on(this.engine, 'collisionStart', this.collisionHandler);
    this.updateKinematics();
  }

  // -------------------------------------------------------------------------
  // World construction
  // -------------------------------------------------------------------------

  private buildTrackBodies() {
    const world = this.engine.world;
    const filter = { category: CATEGORY_TRACK, mask: CATEGORY_MARBLE };
    for (const item of this.track.items) {
      let body: Matter.Body | null = null;
      switch (item.kind) {
        case 'wall': {
          const dx = item.b.x - item.a.x;
          const dy = item.b.y - item.a.y;
          const length = Math.hypot(dx, dy);
          const rounded = item.style !== 'wall';
          body = Bodies.rectangle(
            (item.a.x + item.b.x) / 2,
            (item.a.y + item.b.y) / 2,
            length + (rounded ? item.thickness : 0),
            item.thickness,
            {
              isStatic: true,
              angle: Math.atan2(dy, dx),
              chamfer: rounded ? { radius: item.thickness / 2 - 0.5 } : undefined,
              friction: 0.06,
              restitution: item.style === 'trampoline' ? 0.9 : item.style === 'deflector' ? 0.45 : 0.25,
              collisionFilter: filter,
              label: item.style,
            },
          );
          if (item.style === 'gate') this.gateBodies.push(body);
          break;
        }
        case 'peg':
          body = Bodies.circle(item.x, item.y, item.r, {
            isStatic: true,
            restitution: 0.55,
            friction: 0.02,
            collisionFilter: filter,
            label: 'peg',
          });
          break;
        case 'bumper':
          body = Bodies.circle(item.x, item.y, item.r, {
            isStatic: true,
            restitution: item.restitution,
            friction: 0,
            collisionFilter: filter,
            label: 'bumper',
          });
          break;
        case 'spinner':
          body = this.createSpinner(item, filter);
          this.kinematics.push({ item, body });
          break;
        case 'slider':
          body = Bodies.rectangle(item.x, item.y, item.length + item.thickness, item.thickness, {
            isStatic: true,
            angle: item.angle,
            chamfer: { radius: item.thickness / 2 - 0.5 },
            friction: 0.05,
            restitution: 0.3,
            collisionFilter: filter,
            label: 'slider',
          });
          this.kinematics.push({ item, body });
          break;
        case 'pendulum': {
          const bob = pendulumBob(item, pendulumAngle(item, 0));
          body = Bodies.circle(bob.x, bob.y, item.bobR, {
            isStatic: true,
            restitution: 0.5,
            friction: 0,
            collisionFilter: filter,
            label: 'pendulum',
          });
          this.kinematics.push({ item, body });
          break;
        }
        case 'zone':
          break;
      }
      if (body) {
        this.itemByBodyId.set(body.id, item);
        for (const part of body.parts) this.itemByBodyId.set(part.id, item);
        Composite.add(world, body);
      }
    }
  }

  private createSpinner(item: SpinnerItem, filter: Matter.ICollisionFilter): Matter.Body {
    const { x, y, armLength: L, armThickness: t } = item;
    const opts = { chamfer: { radius: t / 2 - 0.5 }, collisionFilter: filter };
    const parts: Matter.Body[] = [Bodies.circle(x, y, t * 0.95, { collisionFilter: filter })];
    if (item.arms === 3) {
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3;
        parts.push(
          Bodies.rectangle(x + (Math.cos(a) * L) / 2, y + (Math.sin(a) * L) / 2, L + t, t, { ...opts, angle: a }),
        );
      }
    } else {
      const bars = item.arms / 2;
      for (let i = 0; i < bars; i++) {
        parts.push(Bodies.rectangle(x, y, 2 * L + t, t, { ...opts, angle: (i * Math.PI) / bars }));
      }
    }
    const body = Body.create({ parts, label: 'spinner', friction: 0.05, restitution: 0.35 });
    Body.setStatic(body, true);
    Body.setPosition(body, { x, y });
    return body;
  }

  private updateKinematics() {
    const t = this.worldTimeMs / 1000;
    for (const k of this.kinematics) {
      if (k.item.kind === 'spinner') {
        setAngleMoving(k.body, spinnerAngle(k.item, t), true);
      } else if (k.item.kind === 'pendulum') {
        setPositionMoving(k.body, pendulumBob(k.item, pendulumAngle(k.item, t)), true);
      } else {
        setPositionMoving(k.body, { x: k.item.x + sliderOffset(k.item, t), y: k.item.y }, true);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Race control
  // -------------------------------------------------------------------------

  /** Opens the start gate. */
  start() {
    if (this.started) return;
    this.started = true;
    Composite.remove(this.engine.world, this.gateBodies);
    for (const m of this.marbles) {
      // Tiny random nudge so identical start positions never give identical races.
      Body.setVelocity(m.body, { x: this.rng.range(-0.35, 0.35), y: this.rng.range(0, 0.3) });
    }
    this.events.push({ type: 'gate' });
  }

  get isComplete(): boolean {
    return this.started && this.finishedCount === this.marbles.length;
  }

  /** Advances the world by one fixed 1/60 s step. */
  step() {
    this.worldTimeMs += STEP_MS;
    this.stats.steps++;
    this.updateKinematics();

    for (const m of this.marbles) {
      m.prevY = m.body.position.y;
      const zone = m.finished ? undefined : this.zones.find((z) => pointInPolygon(m.body.position, z.polygon));
      m.inMud = zone !== undefined;
      m.body.frictionAir = zone ? zone.drag : BASE_AIR;
    }

    Engine.update(this.engine, STEP_MS);

    if (this.started && !this.isComplete) this.raceTimeMs += STEP_MS;
    this.applyKicks();
    this.trackContacts();
    this.postStep();
  }

  private applyKicks() {
    for (const { marble, nx, ny, minSpeed } of this.pendingKicks) {
      const v = marble.body.velocity;
      const speed = Math.max(Math.hypot(v.x, v.y), minSpeed);
      Body.setVelocity(marble.body, { x: nx * speed, y: ny * speed });
    }
    this.pendingKicks.length = 0;
  }

  /** Records how far each marble has fallen since it last touched anything. */
  private trackContacts() {
    if (!this.started) return;
    const touching = new Set<number>();
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue;
      touching.add(pair.bodyA.parent.id);
      touching.add(pair.bodyB.parent.id);
      this.kickIfResting(pair);
    }
    for (const m of this.marbles) {
      if (m.finished) continue;
      const y = m.body.position.y;
      if (touching.has(m.body.id) || m.ghostSteps > 0) {
        m.lastContactY = y;
      } else if (y - m.lastContactY > m.maxFreeFall) {
        m.maxFreeFall = y - m.lastContactY;
        m.maxFreeFallAt = [m.body.position.x, m.lastContactY, y];
        if (m.maxFreeFall > this.stats.maxFreeFall) this.stats.maxFreeFall = m.maxFreeFall;
      }
      // Moving up (a bounce) resets the reference point.
      if (y < m.lastContactY) m.lastContactY = y;
    }
  }

  /**
   * Bumpers and trampolines are "active" like in pinball: a marble that comes
   * to rest on one gets kicked off again (otherwise it could sit there).
   */
  private kickIfResting(pair: Matter.Pair) {
    const marble = this.marbleByBodyId.get(pair.bodyA.parent.id) ?? this.marbleByBodyId.get(pair.bodyB.parent.id);
    if (!marble || marble.finished || marble.body.speed > 2.5) return;
    const other = this.marbleByBodyId.has(pair.bodyA.parent.id) ? pair.bodyB : pair.bodyA;
    const item = this.itemByBodyId.get(other.id) ?? this.itemByBodyId.get(other.parent.id);
    if (!item) return;
    const pos = marble.body.position;
    if (item.kind === 'bumper') {
      const d = Math.hypot(pos.x - item.x, pos.y - item.y) || 1;
      this.pendingKicks.push({ marble, nx: (pos.x - item.x) / d, ny: (pos.y - item.y) / d, minSpeed: 6.5 });
      this.bumperHits.set(item.id, this.worldTimeMs);
    } else if (item.kind === 'wall' && item.style === 'trampoline') {
      const ux = item.b.x - item.a.x;
      const uy = item.b.y - item.a.y;
      const len = Math.hypot(ux, uy) || 1;
      let nx = -uy / len;
      let ny = ux / len;
      if (nx * (pos.x - item.a.x) + ny * (pos.y - item.a.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      this.pendingKicks.push({ marble, nx, ny, minSpeed: 8 });
      this.bumperHits.set(item.id, this.worldTimeMs);
    }
  }

  private postStep() {
    const { track } = this;
    const newlyFinished: { m: MarbleState; t: number }[] = [];

    for (const m of this.marbles) {
      const body = m.body;
      // Speed limit (keeps marbles from tunnelling through thin walls).
      if (body.speed > MAX_SPEED) {
        const s = MAX_SPEED / body.speed;
        Body.setVelocity(body, { x: body.velocity.x * s, y: body.velocity.y * s });
      }
      // Visual rolling: the swirl turns according to horizontal speed.
      m.spinRate += (body.velocity.x / m.radius - m.spinRate) * 0.15;
      m.spin += m.spinRate;

      if (m.ghostSteps > 0) {
        m.ghostSteps--;
        if (m.ghostSteps === 0) body.collisionFilter.mask = CATEGORY_MARBLE | CATEGORY_TRACK;
      }

      if (m.finished) continue;

      if (this.started && body.position.y >= track.finishY) {
        // Interpolate the exact crossing moment inside this step.
        const moved = body.position.y - m.prevY;
        const frac = moved > 0 ? Math.min(1, (body.position.y - track.finishY) / moved) : 0;
        newlyFinished.push({ m, t: this.raceTimeMs - frac * STEP_MS });
        continue;
      }

      m.progress = this.progressMap.progressAt(body.position.x, body.position.y);
      this.keepInBounds(m);
      if (this.started) this.checkStuck(m);
    }

    newlyFinished.sort((a, b) => a.t - b.t || b.m.body.position.y - a.m.body.position.y);
    for (const { m, t } of newlyFinished) this.markFinished(m, t, false);

    if (this.started && !this.isComplete && this.raceTimeMs >= MAX_RACE_MS) this.finishByDistance();

    if (this.events.length > 600) this.events.splice(0, this.events.length - 300);
  }

  private markFinished(m: MarbleState, timeMs: number, byDistance: boolean) {
    m.finished = true;
    m.finishTimeMs = Math.max(0, timeMs);
    m.progress = 1;
    m.rankedByDistance = byDistance;
    this.finishOrder.push(m);
    this.finishedCount++;
    m.position = this.finishedCount;
    this.events.push({ type: 'finish', marble: m.index, position: m.position });
  }

  /** Safety net only – normally every marble reaches the finish line. */
  private finishByDistance() {
    this.timedOut = true;
    const remaining = this.marbles
      .filter((m) => !m.finished)
      .sort((a, b) => b.progress - a.progress || b.body.position.y - a.body.position.y);
    for (const m of remaining) this.markFinished(m, this.raceTimeMs, true);
  }

  get endedByTimeLimit(): boolean {
    return this.timedOut;
  }

  private keepInBounds(m: MarbleState) {
    const { body, radius } = m;
    const { track } = this;
    const out =
      body.position.x < track.innerLeft - radius ||
      body.position.x > track.innerRight + radius ||
      body.position.y < -200 ||
      body.position.y > track.height + 100;
    if (!out) return;
    this.stats.outOfBounds++;
    Body.setPosition(body, {
      x: Math.min(track.innerRight - radius - 4, Math.max(track.innerLeft + radius + 4, body.position.x)),
      y: Math.min(track.height - 60, Math.max(20, body.position.y)),
    });
    Body.setVelocity(body, { x: 0, y: 0 });
  }

  /**
   * Anti-stuck: if a marble hasn't really moved for a while (e.g. balanced
   * perfectly on top of a peg), give it a small random pop. If that keeps
   * happening, let it slip through the obstacle for a moment.
   */
  private checkStuck(m: MarbleState) {
    if (this.stats.steps % 30 !== 0) return;
    const p = m.body.position;
    m.checkpoints.push({ x: p.x, y: p.y, progress: m.progress });
    if (m.checkpoints.length > 12) m.checkpoints.shift();
    const n = m.checkpoints.length;
    if (n < 3) return;

    const old = m.checkpoints[n - 3]; // ~1 s ago
    const moved = Math.hypot(p.x - old.x, p.y - old.y);
    const stalled = moved < m.radius * 0.6;
    const longAgo = n >= 12 ? m.checkpoints[0] : null; // ~5.5 s ago
    const noProgress = longAgo !== null && m.progress - longAgo.progress < 0.004;

    if (!stalled && !noProgress) return;

    m.nudges++;
    this.stats.nudges++;
    if (this.nudgeLog.length < 200) this.nudgeLog.push({ x: p.x, y: p.y, rescue: m.nudges % 3 === 0 });
    m.checkpoints.length = 0;
    if (m.nudges % 3 === 0) {
      // Repeatedly stuck: let it pass through the track briefly.
      this.stats.rescues++;
      m.body.collisionFilter.mask = CATEGORY_MARBLE;
      m.ghostSteps = 14;
      Body.setVelocity(m.body, { x: 0, y: 3 });
    } else {
      // Pop it up and toward the open middle of the course (away from walls).
      const towardCentre = Math.sign(this.track.width / 2 - p.x) || this.rng.sign();
      Body.setVelocity(m.body, { x: towardCentre * this.rng.range(2.5, 4.5), y: -this.rng.range(2, 3.5) });
    }
  }

  // -------------------------------------------------------------------------
  // Collisions (effects + bumper kicks)
  // -------------------------------------------------------------------------

  private onCollisionStart(event: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of event.pairs) {
      const a = this.marbleByBodyId.get(pair.bodyA.id) ?? this.marbleByBodyId.get(pair.bodyA.parent.id);
      const b = this.marbleByBodyId.get(pair.bodyB.id) ?? this.marbleByBodyId.get(pair.bodyB.parent.id);
      if (!a && !b) continue;

      const normal = pair.collision.normal;
      const va = pair.bodyA.parent.velocity;
      const vb = pair.bodyB.parent.velocity;
      const strength = Math.abs((va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y);
      const support = pair.collision.supports[0] ?? pair.bodyA.position;

      if (a && b) {
        this.stats.marbleCollisions++;
        if (strength > 2.2) {
          this.events.push({
            type: 'hit',
            kind: 'marble',
            x: support.x,
            y: support.y,
            strength,
            marble: a.index,
            other: b.index,
          });
        }
        continue;
      }

      const marble = (a ?? b)!;
      const otherBody = a ? pair.bodyB : pair.bodyA;
      const item = this.itemByBodyId.get(otherBody.id) ?? this.itemByBodyId.get(otherBody.parent.id);
      this.stats.obstacleCollisions++;
      if (!item) continue;

      let kind: HitKind = 'wall';
      if (item.kind === 'bumper') {
        kind = 'bumper';
        this.bumperHits.set(item.id, this.worldTimeMs);
        const dx = marble.body.position.x - item.x;
        const dy = marble.body.position.y - item.y;
        const d = Math.hypot(dx, dy) || 1;
        this.pendingKicks.push({ marble, nx: dx / d, ny: dy / d, minSpeed: 6.5 });
      } else if (item.kind === 'wall' && item.style === 'trampoline') {
        kind = 'trampoline';
        this.bumperHits.set(item.id, this.worldTimeMs);
        // Launch away from the bar's surface, on the side the marble hit.
        const ux = item.b.x - item.a.x;
        const uy = item.b.y - item.a.y;
        const len = Math.hypot(ux, uy) || 1;
        let nx = -uy / len;
        let ny = ux / len;
        if (nx * (marble.body.position.x - item.a.x) + ny * (marble.body.position.y - item.a.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        // Keep most of the sliding motion along the bar, add a strong bounce.
        const v = marble.body.velocity;
        const along = (v.x * ux + v.y * uy) / len;
        const bx = (ux / len) * along * 0.8 + nx * 8.5;
        const by = (uy / len) * along * 0.8 + ny * 8.5;
        const bl = Math.hypot(bx, by) || 1;
        this.pendingKicks.push({ marble, nx: bx / bl, ny: by / bl, minSpeed: Math.min(11, bl) });
      } else if (item.kind === 'peg') kind = 'peg';
      else if (item.kind === 'spinner') kind = 'spinner';
      else if (item.kind === 'slider') kind = 'slider';
      else if (item.kind === 'pendulum') kind = 'pendulum';

      if (kind === 'bumper' || kind === 'trampoline' || strength > 3) {
        this.events.push({
          type: 'hit',
          kind,
          x: support.x,
          y: support.y,
          strength: kind === 'bumper' || kind === 'trampoline' ? Math.max(strength, 6) : strength,
          marble: marble.index,
          itemId: item.id,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Read-only views
  // -------------------------------------------------------------------------

  /** Finished marbles in finishing order, then everyone else by progress. */
  standings(): MarbleState[] {
    const running = this.marbles
      .filter((m) => !m.finished)
      .sort((a, b) => b.progress - a.progress || b.body.position.y - a.body.position.y);
    return [...this.finishOrder, ...running];
  }

  get finishingOrder(): readonly MarbleState[] {
    return this.finishOrder;
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Current time for moving parts, in seconds (renderer uses it). */
  get kinematicTimeSec(): number {
    return this.worldTimeMs / 1000;
  }

  destroy() {
    Events.off(this.engine, 'collisionStart', this.collisionHandler);
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }
}
