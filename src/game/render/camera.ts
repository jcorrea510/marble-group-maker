import { TRACK_WIDTH } from '../track/constants';

/**
 * Follows the action vertically. The course is always shown at full width
 * (when the screen allows), so the camera only scrolls up and down.
 */
export class Camera {
  /** World coordinates of the view centre. */
  x = TRACK_WIDTH / 2;
  y = 0;
  scale = 1;
  viewW = 800;
  viewH = 600;
  /** Screen x of the course centre (the right edge is kept free for the minimap). */
  centerX = 400;
  private trauma = 0;
  shakeX = 0;
  shakeY = 0;
  private shakeTime = 0;

  constructor(private readonly trackHeight: number) {}

  resize(viewW: number, viewH: number, reserveRight = 0) {
    this.viewW = viewW;
    this.viewH = viewH;
    const usable = viewW - reserveRight;
    // Fit the course width, but always show at least ~720 world units vertically.
    const fitWidth = usable / (TRACK_WIDTH + 30);
    const fitHeight = viewH / 720;
    this.scale = Math.max(0.2, Math.min(fitWidth, fitHeight, 1.6));
    this.centerX = usable / 2;
  }

  /** Visible world height. */
  get worldViewH() {
    return this.viewH / this.scale;
  }

  get top() {
    return this.y - this.worldViewH / 2;
  }

  get bottom() {
    return this.y + this.worldViewH / 2;
  }

  clampY(y: number): number {
    const half = this.worldViewH / 2;
    if (this.trackHeight <= half * 2) return this.trackHeight / 2;
    return Math.max(half - 60, Math.min(this.trackHeight - half + 40, y));
  }

  /** Smoothly move toward a target y. */
  follow(targetY: number, dt: number, stiffness = 3.2) {
    const target = this.clampY(targetY);
    const k = 1 - Math.exp(-stiffness * dt);
    this.y += (target - this.y) * k;
  }

  jumpTo(y: number) {
    this.y = this.clampY(y);
  }

  /** Never let `y` fall below `fraction` of the view height (keeps the leader visible). */
  keepAbove(y: number, fraction: number) {
    const limit = y - this.worldViewH * (fraction - 0.5);
    if (this.y < limit) this.y = this.clampY(limit);
  }

  addShake(amount: number) {
    this.trauma = Math.min(0.7, this.trauma + amount);
  }

  updateShake(dt: number, reducedMotion: boolean) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeTime += dt;
    const power = reducedMotion ? 0 : this.trauma * this.trauma * 9;
    this.shakeX = power * Math.sin(this.shakeTime * 71.3) * Math.cos(this.shakeTime * 23.1);
    this.shakeY = power * Math.sin(this.shakeTime * 57.7 + 1.3);
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [
      (x - this.x) * this.scale + this.centerX + this.shakeX,
      (y - this.y) * this.scale + this.viewH / 2 + this.shakeY,
    ];
  }

  apply(ctx: CanvasRenderingContext2D) {
    ctx.translate(this.centerX + this.shakeX, this.viewH / 2 + this.shakeY);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.x, -this.y);
  }
}
