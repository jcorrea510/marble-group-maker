import { marbleStyle, rgba } from '../colors';
import { sliderEndpoints } from '../track/geometry';
import { pendulumAngle, pendulumBob, sliderOffset, spinnerAngle } from '../physics/kinematics';
import type { MarbleState, RaceSimulation } from '../physics/raceSimulation';
import type { BumperItem, PegItem, PendulumItem, SliderItem, SpinnerItem, Track, WallItem, ZoneItem } from '../track/types';
import { Camera } from './camera';
import { Particles } from './particles';
import { MarbleSprites } from './sprites';
import { BACKGROUND, DISPLAY_FONT, LABEL_FONT, SECTION_COLORS, WALL_BODY } from './theme';

export interface RenderFrame {
  /** Wall-clock seconds since the previous frame. */
  dt: number;
  /** Seconds since the race screen opened (for ambient animation). */
  clock: number;
  /** 0..1 interpolation between the previous and current physics step. */
  alpha: number;
  /** Seconds since the gate opened, or null while closed. */
  gateOpenFor: number | null;
  followIndex: number | null;
  /** Marbles in current race order. */
  standings: readonly MarbleState[];
  /** Positions of every marble at the previous physics step (x0,y0,x1,y1...). */
  prevPositions: Float64Array;
  reducedMotion: boolean;
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SPINNER_COLOR = '#ffd23f';
const SLIDER_COLOR = '#1ee3cf';
const PENDULUM_COLOR = '#ff4fd8';
const TRAMPOLINE_COLOR = '#fb7185';
const BUMPER_COLOR = '#ff9f1c';
const TRAIL_LENGTH = 9;

export class RaceRenderer {
  readonly camera: Camera;
  readonly particles = new Particles();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new MarbleSprites();
  private dpr = 1;
  private readonly walls: { item: WallItem; color: string; top: number; bottom: number }[] = [];
  private readonly outerWalls: WallItem[] = [];
  private readonly pegs: { item: PegItem; color: string }[] = [];
  private readonly bumpers: BumperItem[] = [];
  private readonly spinners: SpinnerItem[] = [];
  private readonly sliders: SliderItem[] = [];
  private readonly pendulums: PendulumItem[] = [];
  private readonly trampolines: WallItem[] = [];
  private readonly zones: ZoneItem[] = [];
  private readonly gates: WallItem[] = [];
  private readonly trails: Float64Array[];
  private readonly trailHead: number[];
  private labelWidths = new Map<number, number>();
  private finishFlash = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly track: Track,
    private readonly sim: RaceSimulation,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = new Camera(track.height);
    const gateSet = new Set(track.gateIds);

    for (const item of track.items) {
      switch (item.kind) {
        case 'wall': {
          if (gateSet.has(item.id)) this.gates.push(item);
          else if (item.style === 'trampoline') this.trampolines.push(item);
          else if (item.style === 'wall') this.outerWalls.push(item);
          else {
            const top = Math.min(item.a.y, item.b.y) - item.thickness;
            const bottom = Math.max(item.a.y, item.b.y) + item.thickness;
            this.walls.push({ item, color: this.colorAt((top + bottom) / 2), top, bottom });
          }
          break;
        }
        case 'peg':
          this.pegs.push({ item, color: this.colorAt(item.y) });
          break;
        case 'bumper':
          this.bumpers.push(item);
          break;
        case 'spinner':
          this.spinners.push(item);
          break;
        case 'pendulum':
          this.pendulums.push(item);
          break;
        case 'slider':
          this.sliders.push(item);
          break;
        case 'zone':
          this.zones.push(item);
          break;
      }
    }
    this.trails = sim.marbles.map(() => new Float64Array(TRAIL_LENGTH * 2).fill(NaN));
    this.trailHead = sim.marbles.map(() => 0);
  }

  private colorAt(y: number): string {
    const s = this.track.sections.find((sec) => y >= sec.y0 && y < sec.y1) ?? this.track.sections[this.track.sections.length - 1];
    return SECTION_COLORS[s.type];
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.camera.resize(cssW, cssH, cssW >= 420 ? 74 : 0);
    this.sprites.setResolution(this.track.marbleRadius * this.camera.scale * dpr);
  }

  flashFinish() {
    this.finishFlash = 1;
  }

  // -------------------------------------------------------------------------

  render(frame: RenderFrame) {
    const { ctx, camera } = this;
    this.particles.update(frame.dt);
    this.finishFlash = Math.max(0, this.finishFlash - frame.dt * 1.8);
    camera.updateShake(frame.dt, frame.reducedMotion);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground();

    ctx.save();
    camera.apply(ctx);
    const top = camera.top - 60;
    const bottom = camera.bottom + 60;
    const kinematicTime = this.sim.kinematicTimeSec - (1 - frame.alpha) / 60;

    this.drawSectionBands(top, bottom);
    this.drawZones(top, bottom, frame.clock);
    this.drawOuterWalls(top, bottom);
    this.drawWalls(top, bottom);
    this.drawPegs(top, bottom);
    this.drawBumpers(top, bottom);
    this.drawSpinners(top, bottom, kinematicTime);
    this.drawSliders(top, bottom, kinematicTime);
    this.drawTrampolines(top, bottom);
    this.drawPendulums(top, bottom, kinematicTime);
    this.drawGate(frame.gateOpenFor, top, bottom);
    this.drawFinishLine(top, bottom, frame.clock);

    const positions = this.interpolatedPositions(frame);
    this.drawTrails(positions, top, bottom);
    this.drawMarbles(positions, frame, top, bottom);
    this.particles.draw(ctx, top, bottom, 1 / camera.scale);
    ctx.restore();

    this.drawSectionLabels(top, bottom);
    this.drawNameLabels(positions, frame);
    this.drawMinimap(positions, frame);
  }

  // -------------------------------------------------------------------------
  // Background & sections
  // -------------------------------------------------------------------------

  private drawBackground() {
    const { ctx, camera } = this;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);

    // Parallax dot grid.
    const spacing = 46;
    const offset = (-(camera.y * camera.scale * 0.45) % spacing) + spacing;
    ctx.fillStyle = 'rgba(160, 170, 255, 0.07)';
    for (let y = offset - spacing; y < camera.viewH + spacing; y += spacing) {
      for (let x = (camera.viewW / 2) % spacing; x < camera.viewW; x += spacing) {
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    }

    // Course backdrop.
    const [x0] = camera.worldToScreen(0, 0);
    const [x1] = camera.worldToScreen(this.track.width, 0);
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(20, 24, 52, 0.85)');
    g.addColorStop(0.5, 'rgba(14, 17, 38, 0.6)');
    g.addColorStop(1, 'rgba(20, 24, 52, 0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, x1 - x0, camera.viewH);
  }

  private drawSectionBands(top: number, bottom: number) {
    const { ctx } = this;
    const { innerLeft, innerRight } = this.track;
    for (const s of this.track.sections) {
      if (s.y1 < top || s.y0 > bottom) continue;
      const color = SECTION_COLORS[s.type];
      const g = ctx.createLinearGradient(0, s.y0, 0, s.y1);
      g.addColorStop(0, rgba(color, 0.07));
      g.addColorStop(0.35, rgba(color, 0.025));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(innerLeft, s.y0, innerRight - innerLeft, s.y1 - s.y0);
      if (s.type !== 'start') {
        ctx.strokeStyle = rgba(color, 0.18);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.moveTo(innerLeft, s.y0);
        ctx.lineTo(innerRight, s.y0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawSectionLabels(top: number, bottom: number) {
    const { ctx, camera } = this;
    ctx.save();
    ctx.textBaseline = 'middle';
    for (const s of this.track.sections) {
      if (s.type === 'start' || s.y1 < top || s.y0 > bottom) continue;
      const color = SECTION_COLORS[s.type];
      const [sx, sy] = camera.worldToScreen(this.track.innerLeft + 12, s.y0 + 20);
      ctx.font = `800 ${Math.round(11 + camera.scale * 2)}px ${LABEL_FONT}`;
      ctx.letterSpacing = '0.14em';
      ctx.fillStyle = rgba(color, 0.85);
      ctx.fillText(s.label.toUpperCase(), sx, sy);
      if (s.lanes) {
        ctx.font = `700 ${Math.round(10 + camera.scale * 2)}px ${LABEL_FONT}`;
        for (const lane of s.lanes) {
          const [lx, ly] = camera.worldToScreen((lane.xl + lane.xr) / 2, s.y0 + 150);
          const text = lane.label.toUpperCase();
          const w = ctx.measureText(text).width + 16;
          ctx.fillStyle = 'rgba(8, 10, 22, 0.75)';
          this.roundRect(lx - w / 2, ly - 10, w, 20, 10);
          ctx.fill();
          ctx.fillStyle = rgba(color, 0.9);
          ctx.textAlign = 'center';
          ctx.fillText(text, lx, ly + 0.5);
          ctx.textAlign = 'left';
        }
      }
    }
    // START / FINISH captions.
    ctx.letterSpacing = '0.3em';
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(12 + camera.scale * 4)}px ${DISPLAY_FONT}`;
    if (this.track.finishY > top && this.track.finishY - 60 < bottom) {
      const [fx, fy] = camera.worldToScreen((this.track.finishX1 + this.track.finishX2) / 2, this.track.finishY + 44);
      ctx.fillStyle = rgba('#ffc53d', 0.75 + this.finishFlash * 0.25);
      ctx.fillText('FINISH', fx + 4, fy);
    }
    if (this.track.gateY > top && this.track.gateY < bottom + 200) {
      const [gx, gy] = camera.worldToScreen(this.track.width / 2, this.track.gateY + 34);
      ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
      ctx.fillText('START', gx + 4, gy);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Track pieces
  // -------------------------------------------------------------------------

  private drawOuterWalls(top: number, bottom: number) {
    const { ctx } = this;
    const { innerLeft, innerRight, width, height } = this.track;
    const y0 = Math.max(-40, top);
    const y1 = Math.min(height, bottom);
    ctx.fillStyle = '#0b0e20';
    ctx.fillRect(0, y0, innerLeft, y1 - y0);
    ctx.fillRect(innerRight, y0, width - innerRight, y1 - y0);
    // Neon inner edges.
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(143, 152, 214, 0.55)';
    ctx.beginPath();
    ctx.moveTo(innerLeft, y0);
    ctx.lineTo(innerLeft, y1);
    ctx.moveTo(innerRight, y0);
    ctx.lineTo(innerRight, y1);
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(143, 152, 214, 0.06)';
    ctx.stroke();
  }

  private drawWalls(top: number, bottom: number) {
    const { ctx } = this;
    const byColor = new Map<string, WallItem[]>();
    for (const w of this.walls) {
      if (w.bottom < top || w.top > bottom) continue;
      let list = byColor.get(w.color);
      if (!list) byColor.set(w.color, (list = []));
      list.push(w.item);
    }
    ctx.lineCap = 'round';
    for (const [color, list] of byColor) {
      // Group by thickness so each batch is a single path.
      const byThickness = new Map<number, WallItem[]>();
      for (const w of list) {
        const key = Math.round(w.thickness);
        let l = byThickness.get(key);
        if (!l) byThickness.set(key, (l = []));
        l.push(w);
      }
      for (const [t, walls] of byThickness) {
        ctx.beginPath();
        for (const w of walls) {
          ctx.moveTo(w.a.x, w.a.y);
          ctx.lineTo(w.b.x, w.b.y);
        }
        ctx.strokeStyle = rgba(color, 0.12);
        ctx.lineWidth = t + 12;
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = t;
        ctx.stroke();
        ctx.strokeStyle = WALL_BODY;
        ctx.lineWidth = t - 4.5;
        ctx.stroke();
        ctx.strokeStyle = rgba(color, 0.22);
        ctx.lineWidth = Math.max(1.5, t * 0.18);
        ctx.stroke();
      }
    }
  }

  private drawPegs(top: number, bottom: number) {
    const { ctx } = this;
    const byColor = new Map<string, PegItem[]>();
    for (const p of this.pegs) {
      if (p.item.y < top || p.item.y > bottom) continue;
      let list = byColor.get(p.color);
      if (!list) byColor.set(p.color, (list = []));
      list.push(p.item);
    }
    for (const [color, pegs] of byColor) {
      ctx.beginPath();
      for (const p of pegs) {
        ctx.moveTo(p.x + p.r + 5, p.y);
        ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
      }
      ctx.fillStyle = rgba(color, 0.1);
      ctx.fill();
      ctx.beginPath();
      for (const p of pegs) {
        ctx.moveTo(p.x + p.r, p.y);
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      }
      ctx.fillStyle = WALL_BODY;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.55);
      ctx.beginPath();
      for (const p of pegs) {
        ctx.moveTo(p.x - p.r * 0.3 + 1.6, p.y - p.r * 0.3);
        ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, 1.6, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  private drawBumpers(top: number, bottom: number) {
    const { ctx } = this;
    const now = this.sim.worldTimeMs;
    for (const b of this.bumpers) {
      if (b.y + b.r < top || b.y - b.r > bottom) continue;
      const hit = this.sim.bumperHits.get(b.id);
      const flash = hit === undefined ? 0 : Math.max(0, 1 - (now - hit) / 260);
      const r = b.r * (1 + flash * 0.12);

      const glow = ctx.createRadialGradient(b.x, b.y, r * 0.8, b.x, b.y, r + 16);
      glow.addColorStop(0, rgba(BUMPER_COLOR, 0.25 + flash * 0.5));
      glow.addColorStop(1, rgba(BUMPER_COLOR, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 16, 0, Math.PI * 2);
      ctx.fill();

      const body = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
      body.addColorStop(0, flash > 0.1 ? '#fff4d6' : '#ffcf7a');
      body.addColorStop(0.55, BUMPER_COLOR);
      body.addColorStop(1, '#8a3d00');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = flash > 0.1 ? '#ffffff' : 'rgba(255, 240, 210, 0.85)';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(80, 30, 0, 0.55)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(b.x - r * 0.35, b.y - r * 0.38, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSpinners(top: number, bottom: number, t: number) {
    const { ctx } = this;
    for (const s of this.spinners) {
      const reach = s.armLength + s.armThickness;
      if (s.y + reach < top || s.y - reach > bottom) continue;
      const angle = spinnerAngle(s, t);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(angle);
      // Faint swept circle.
      ctx.strokeStyle = rgba(SPINNER_COLOR, 0.08);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, s.armLength + s.armThickness / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      const L = s.armLength;
      if (s.arms === 3) {
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * Math.PI) / 3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
        }
      } else {
        const bars = s.arms / 2;
        for (let i = 0; i < bars; i++) {
          const a = (i * Math.PI) / bars;
          ctx.moveTo(-Math.cos(a) * L, -Math.sin(a) * L);
          ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
        }
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(SPINNER_COLOR, 0.16);
      ctx.lineWidth = s.armThickness + 12;
      ctx.stroke();
      ctx.strokeStyle = SPINNER_COLOR;
      ctx.lineWidth = s.armThickness;
      ctx.stroke();
      ctx.strokeStyle = '#3a2a00';
      ctx.lineWidth = s.armThickness - 5;
      ctx.stroke();

      ctx.fillStyle = SPINNER_COLOR;
      ctx.beginPath();
      ctx.arc(0, 0, s.armThickness * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a00';
      ctx.beginPath();
      ctx.arc(0, 0, s.armThickness * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTrampolines(top: number, bottom: number) {
    const { ctx } = this;
    const now = this.sim.worldTimeMs;
    ctx.lineCap = 'round';
    for (const tr of this.trampolines) {
      if (Math.max(tr.a.y, tr.b.y) + 30 < top || Math.min(tr.a.y, tr.b.y) - 30 > bottom) continue;
      const hit = this.sim.bumperHits.get(tr.id);
      const flash = hit === undefined ? 0 : Math.max(0, 1 - (now - hit) / 240);
      // Springs underneath.
      const ux = tr.b.x - tr.a.x;
      const uy = tr.b.y - tr.a.y;
      const len = Math.hypot(ux, uy) || 1;
      const nx = -uy / len;
      const ny = ux / len;
      const down = ny >= 0 ? 1 : -1;
      ctx.strokeStyle = rgba(TRAMPOLINE_COLOR, 0.55);
      ctx.lineWidth = 2;
      for (const f of [0.2, 0.5, 0.8]) {
        const px = tr.a.x + ux * f;
        const py = tr.a.y + uy * f;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const d = (k / 6) * (14 - flash * 5) + tr.thickness / 2;
          const side = (k % 2 === 0 ? -1 : 1) * 4;
          const sx = px + nx * d * down + (ux / len) * side;
          const sy = py + ny * d * down + (uy / len) * side;
          if (k === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(tr.a.x, tr.a.y);
      ctx.lineTo(tr.b.x, tr.b.y);
      ctx.strokeStyle = rgba(TRAMPOLINE_COLOR, 0.18 + flash * 0.4);
      ctx.lineWidth = tr.thickness + 14;
      ctx.stroke();
      ctx.strokeStyle = flash > 0.2 ? '#ffe4ea' : TRAMPOLINE_COLOR;
      ctx.lineWidth = tr.thickness;
      ctx.stroke();
      ctx.strokeStyle = '#3d0b17';
      ctx.lineWidth = tr.thickness - 6;
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.35);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawPendulums(top: number, bottom: number, t: number) {
    const { ctx } = this;
    for (const p of this.pendulums) {
      if (p.pivotY - 30 > bottom || p.pivotY + p.length + p.bobR < top) continue;
      const angle = pendulumAngle(p, t);
      const bob = pendulumBob(p, angle);
      // Swing arc.
      ctx.strokeStyle = rgba(PENDULUM_COLOR, 0.1);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(p.pivotX, p.pivotY, p.length, Math.PI / 2 - p.amplitude, Math.PI / 2 + p.amplitude);
      ctx.stroke();
      ctx.setLineDash([]);
      // Chain.
      ctx.strokeStyle = rgba('#e6d2ff', 0.7);
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p.pivotX, p.pivotY);
      ctx.lineTo(bob.x, bob.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PENDULUM_COLOR;
      ctx.beginPath();
      ctx.arc(p.pivotX, p.pivotY, 6, 0, Math.PI * 2);
      ctx.fill();
      // Wrecking ball.
      const glow = ctx.createRadialGradient(bob.x, bob.y, p.bobR * 0.8, bob.x, bob.y, p.bobR + 16);
      glow.addColorStop(0, rgba(PENDULUM_COLOR, 0.35));
      glow.addColorStop(1, rgba(PENDULUM_COLOR, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(bob.x, bob.y, p.bobR + 16, 0, Math.PI * 2);
      ctx.fill();
      const body = ctx.createRadialGradient(bob.x - p.bobR * 0.35, bob.y - p.bobR * 0.4, p.bobR * 0.1, bob.x, bob.y, p.bobR);
      body.addColorStop(0, '#6b6f8f');
      body.addColorStop(0.6, '#2a2c44');
      body.addColorStop(1, '#101122');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(bob.x, bob.y, p.bobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PENDULUM_COLOR;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(bob.x - p.bobR * 0.35, bob.y - p.bobR * 0.4, p.bobR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSliders(top: number, bottom: number, t: number) {
    const { ctx } = this;
    for (const s of this.sliders) {
      if (s.y + s.length < top || s.y - s.length > bottom) continue;
      const offset = sliderOffset(s, t);
      // Rail showing the travel range.
      const [l0] = sliderEndpoints(s, -s.amplitude);
      const [, r1] = sliderEndpoints(s, s.amplitude);
      ctx.strokeStyle = rgba(SLIDER_COLOR, 0.12);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(l0.x, s.y);
      ctx.lineTo(r1.x, s.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const [a, b] = sliderEndpoints(s, offset);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = rgba(SLIDER_COLOR, 0.16);
      ctx.lineWidth = s.thickness + 12;
      ctx.stroke();
      ctx.strokeStyle = SLIDER_COLOR;
      ctx.lineWidth = s.thickness;
      ctx.stroke();
      ctx.strokeStyle = '#06312e';
      ctx.lineWidth = s.thickness - 5;
      ctx.stroke();
      ctx.strokeStyle = rgba(SLIDER_COLOR, 0.6);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawZones(top: number, bottom: number, clock: number) {
    const { ctx } = this;
    for (const z of this.zones) {
      const ys = z.polygon.map((p) => p.y);
      if (Math.max(...ys) < top || Math.min(...ys) > bottom) continue;
      ctx.beginPath();
      z.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const g = ctx.createLinearGradient(0, minY, 0, maxY);
      g.addColorStop(0, 'rgba(224, 168, 74, 0.08)');
      g.addColorStop(1, 'rgba(160, 100, 35, 0.5)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(224, 168, 74, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Bubbles.
      const [p0, p1] = z.polygon;
      ctx.fillStyle = 'rgba(255, 210, 140, 0.35)';
      for (let i = 0; i < 6; i++) {
        const u = ((i * 0.37 + clock * 0.05) % 1 + 1) % 1;
        const phase = (clock * 0.8 + i * 0.61) % 1;
        const x = p0.x + (p1.x - p0.x) * u;
        const y = p0.y + (p1.y - p0.y) * u - 6 - phase * 26;
        ctx.globalAlpha = 1 - phase;
        ctx.beginPath();
        ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawGate(openFor: number | null, top: number, bottom: number) {
    if (this.track.gateY < top || this.track.gateY > bottom) return;
    if (openFor !== null && openFor > 1.2) return;
    const { ctx } = this;
    const open = openFor === null ? 0 : Math.min(1, openFor / 0.35);
    const eased = 1 - Math.pow(1 - open, 3);
    const fade = openFor === null ? 1 : Math.max(0, 1 - Math.max(0, openFor - 0.6) / 0.6);
    ctx.globalAlpha = fade;
    for (const g of this.gates) {
      // Each half is a trapdoor hinged at the outer wall.
      const hinge = g.a.x < g.b.x && g.a.x < this.track.width / 2 ? g.a : g.b;
      const other = hinge === g.a ? g.b : g.a;
      const dir = other.x > hinge.x ? 1 : -1;
      const len = Math.abs(other.x - hinge.x);
      const angle = eased * (Math.PI / 2.2) * dir;
      const end = { x: hinge.x + Math.cos(angle) * len * dir, y: hinge.y + Math.sin(Math.abs(angle)) * len };
      ctx.lineCap = 'butt';
      ctx.lineWidth = g.thickness;
      ctx.strokeStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(hinge.x, hinge.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = '#1a1405';
      ctx.setLineDash([14, 14]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawFinishLine(top: number, bottom: number, clock: number) {
    const { ctx } = this;
    const { finishY, finishX1, finishX2, innerLeft, innerRight } = this.track;
    if (finishY < top - 40 || finishY > bottom + 40) return;
    // Faint glow line across the course.
    const pulse = 0.5 + 0.5 * Math.sin(clock * 3);
    ctx.strokeStyle = rgba('#ffc53d', 0.12 + 0.08 * pulse + this.finishFlash * 0.5);
    ctx.lineWidth = 3 + this.finishFlash * 6;
    ctx.beginPath();
    ctx.moveTo(innerLeft, finishY);
    ctx.lineTo(innerRight, finishY);
    ctx.stroke();

    // Checkered band across the finish gate.
    const x0 = finishX1 - 14;
    const x1 = finishX2 + 14;
    const sq = 8;
    for (let row = 0; row < 2; row++) {
      for (let x = x0, i = 0; x < x1; x += sq, i++) {
        ctx.fillStyle = (i + row) % 2 === 0 ? '#ffffff' : '#11131f';
        ctx.fillRect(x, finishY - sq + row * sq, Math.min(sq, x1 - x), sq);
      }
    }
    ctx.strokeStyle = rgba('#ffc53d', 0.9);
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, finishY - sq, x1 - x0, sq * 2);
    // Posts.
    for (const px of [x0, x1]) {
      ctx.fillStyle = '#ffc53d';
      ctx.beginPath();
      ctx.arc(px, finishY, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------------
  // Marbles
  // -------------------------------------------------------------------------

  private interpolatedPositions(frame: RenderFrame): Float64Array {
    const out = new Float64Array(this.sim.marbles.length * 2);
    for (const m of this.sim.marbles) {
      const px = frame.prevPositions[m.index * 2];
      const py = frame.prevPositions[m.index * 2 + 1];
      const p = m.body.position;
      const jump = Math.abs(p.x - px) + Math.abs(p.y - py) > 80; // teleported: don't smear
      out[m.index * 2] = jump ? p.x : px + (p.x - px) * frame.alpha;
      out[m.index * 2 + 1] = jump ? p.y : py + (p.y - py) * frame.alpha;
    }
    return out;
  }

  private drawTrails(pos: Float64Array, top: number, bottom: number) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const m of this.sim.marbles) {
      const trail = this.trails[m.index];
      const head = this.trailHead[m.index];
      trail[head * 2] = pos[m.index * 2];
      trail[head * 2 + 1] = pos[m.index * 2 + 1];
      this.trailHead[m.index] = (head + 1) % TRAIL_LENGTH;

      if (m.finished || m.body.speed < 5) continue;
      const y = pos[m.index * 2 + 1];
      if (y < top || y > bottom) continue;
      const color = marbleStyle(m.participant.colorIndex).base;
      ctx.beginPath();
      let started = false;
      for (let k = 1; k <= TRAIL_LENGTH; k++) {
        const idx = (head + k) % TRAIL_LENGTH;
        const tx = trail[idx * 2];
        const ty = trail[idx * 2 + 1];
        if (Number.isNaN(tx)) continue;
        if (!started) {
          ctx.moveTo(tx, ty);
          started = true;
        } else ctx.lineTo(tx, ty);
      }
      ctx.strokeStyle = rgba(color, Math.min(0.32, (m.body.speed - 5) * 0.03));
      ctx.lineWidth = m.radius * 1.1;
      ctx.stroke();
    }
  }

  private drawMarbles(pos: Float64Array, frame: RenderFrame, top: number, bottom: number) {
    const { ctx } = this;
    const gloss = this.sprites.glossSprite();
    const leader = this.sim.started ? frame.standings.find((m) => !m.finished) : undefined;

    // Glows first (additive), then bodies on top.
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.sim.marbles) {
      const x = pos[m.index * 2];
      const y = pos[m.index * 2 + 1];
      if (y < top || y > bottom) continue;
      const R = m.radius * MarbleSprites.GLOW_SCALE;
      ctx.globalAlpha = m.finished ? 0.35 : 0.8;
      ctx.drawImage(this.sprites.glow(m.participant.colorIndex), x - R, y - R, R * 2, R * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const m of this.sim.marbles) {
      const x = pos[m.index * 2];
      const y = pos[m.index * 2 + 1];
      if (y < top || y > bottom) continue;
      const r = m.radius;
      // Contact shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.15, y + r * 0.85, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(m.spin);
      ctx.drawImage(this.sprites.body(m.participant.colorIndex), -r - 1 / this.camera.scale, -r - 1 / this.camera.scale, r * 2 + 2 / this.camera.scale, r * 2 + 2 / this.camera.scale);
      ctx.restore();
      ctx.drawImage(gloss, x - r, y - r, r * 2, r * 2);

      if (m.inMud) {
        ctx.strokeStyle = 'rgba(224, 168, 74, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
      if (m === leader) {
        ctx.strokeStyle = 'rgba(255, 197, 61, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (frame.followIndex === m.index) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(frame.clock * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawNameLabels(pos: Float64Array, frame: RenderFrame) {
    const { ctx, camera } = this;
    const placed: LabelBox[] = [];
    const fontSize = camera.scale < 0.6 ? 10 : 11.5;
    ctx.save();
    ctx.font = `700 ${fontSize}px ${LABEL_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const h = fontSize + 7;

    // Followed marble first, then race order: leaders get the best spots.
    const order = [...frame.standings];
    if (frame.followIndex !== null) {
      const i = order.findIndex((m) => m.index === frame.followIndex);
      if (i > 0) order.unshift(...order.splice(i, 1));
    }
    const leader = this.sim.started ? frame.standings.find((m) => !m.finished) : undefined;

    for (const m of order) {
      const [sx, sy] = camera.worldToScreen(pos[m.index * 2], pos[m.index * 2 + 1]);
      if (sy < -30 || sy > camera.viewH + 30 || sx < -60 || sx > camera.viewW + 60) continue;
      const prefix = m.finished && m.position !== null ? `${m.position}. ` : '';
      const text = prefix + m.participant.name;
      const key = m.index * 1000 + (m.position ?? 0) + fontSize * 100000;
      let w = this.labelWidths.get(key);
      if (w === undefined) {
        w = ctx.measureText(text).width + 14;
        this.labelWidths.set(key, w);
      }
      const rPx = m.radius * camera.scale;
      const candidates: [number, number][] = [
        [sx, sy - rPx - h / 2 - 5],
        [sx, sy + rPx + h / 2 + 5],
        [sx + rPx + w / 2 + 5, sy],
        [sx - rPx - w / 2 - 5, sy],
      ];
      let chosen: [number, number] | null = null;
      for (const c of candidates) {
        const box = { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
        if (!placed.some((p) => overlaps(p, box))) {
          chosen = c;
          placed.push(box);
          break;
        }
      }
      const faded = chosen === null;
      const [lx, ly] = chosen ?? candidates[0];
      const style = marbleStyle(m.participant.colorIndex);
      const followed = frame.followIndex === m.index;

      ctx.globalAlpha = faded ? 0.28 : m.finished ? 0.8 : 1;
      ctx.fillStyle = followed ? 'rgba(255,255,255,0.95)' : 'rgba(8, 10, 22, 0.8)';
      this.roundRect(lx - w / 2, ly - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = rgba(style.base, followed ? 1 : 0.75);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = followed ? '#0b0d1a' : '#ffffff';
      ctx.fillText(text, lx, ly + 0.5);

      if (m === leader && !faded) this.drawCrown(lx - w / 2 - 2, ly - h / 2 - 2);
    }
    ctx.restore();
  }

  private drawCrown(x: number, y: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.fillStyle = '#ffc53d';
    ctx.beginPath();
    ctx.moveTo(-7, 3);
    ctx.lineTo(-7, -4);
    ctx.lineTo(-3.5, -0.5);
    ctx.lineTo(0, -6);
    ctx.lineTo(3.5, -0.5);
    ctx.lineTo(7, -4);
    ctx.lineTo(7, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  private drawMinimap(pos: Float64Array, frame: RenderFrame) {
    const { ctx, camera, track } = this;
    if (camera.viewW < 420) return;
    const w = 46;
    const h = Math.min(camera.viewH - 32, 560);
    const x = camera.viewW - w - 14;
    const y = (camera.viewH - h) / 2;
    const sy = h / track.height;
    const sx = w / track.width;

    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 22, 0.78)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    this.roundRect(x - 5, y - 5, w + 10, h + 10, 10);
    ctx.fill();
    ctx.stroke();

    for (const s of track.sections) {
      ctx.fillStyle = rgba(SECTION_COLORS[s.type], 0.2);
      ctx.fillRect(x, y + s.y0 * sy, w, Math.max(1, (s.y1 - s.y0) * sy - 1));
    }
    // Finish line.
    ctx.fillStyle = '#ffc53d';
    ctx.fillRect(x, y + track.finishY * sy - 1, w, 2);

    // Current view.
    const vy0 = Math.max(0, camera.top) * sy;
    const vy1 = Math.min(track.height, camera.bottom) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 2, y + vy0, w + 4, Math.max(4, vy1 - vy0));

    for (const m of this.sim.marbles) {
      const mx = x + pos[m.index * 2] * sx;
      const my = y + Math.min(track.height, pos[m.index * 2 + 1]) * sy;
      ctx.fillStyle = marbleStyle(m.participant.colorIndex).base;
      ctx.beginPath();
      ctx.arc(mx, my, frame.followIndex === m.index ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
