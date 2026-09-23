import { marbleStyle, mix, rgba } from '../colors';

/**
 * Pre-drawn marble images. Drawing gradients for 50 marbles every frame is
 * slow, so each marble is painted once into a small off-screen canvas and
 * then stamped onto the race canvas.
 */
export class MarbleSprites {
  private bodies = new Map<number, HTMLCanvasElement>();
  private glows = new Map<number, HTMLCanvasElement>();
  private gloss: HTMLCanvasElement | null = null;
  private pixelRadius = 0;

  /** @param pixelRadius marble radius in device pixels at the current zoom. */
  setResolution(pixelRadius: number) {
    const r = Math.max(4, Math.ceil(pixelRadius));
    if (r === this.pixelRadius) return;
    this.pixelRadius = r;
    this.bodies.clear();
    this.glows.clear();
    this.gloss = null;
  }

  body(colorIndex: number): HTMLCanvasElement {
    let c = this.bodies.get(colorIndex);
    if (!c) {
      c = this.paintBody(colorIndex);
      this.bodies.set(colorIndex, c);
    }
    return c;
  }

  glow(colorIndex: number): HTMLCanvasElement {
    let c = this.glows.get(colorIndex);
    if (!c) {
      c = this.paintGlow(colorIndex);
      this.glows.set(colorIndex, c);
    }
    return c;
  }

  glossSprite(): HTMLCanvasElement {
    if (!this.gloss) this.gloss = this.paintGloss();
    return this.gloss;
  }

  private canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return [c, c.getContext('2d')!];
  }

  private paintBody(colorIndex: number): HTMLCanvasElement {
    const r = this.pixelRadius;
    const size = r * 2 + 2;
    const [c, ctx] = this.canvas(size);
    const style = marbleStyle(colorIndex);
    ctx.translate(size / 2, size / 2);

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    // Glass body with depth.
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0, mix(style.base, '#ffffff', 0.35));
    g.addColorStop(0.5, style.base);
    g.addColorStop(1, mix(style.base, '#000000', 0.55));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // The swirl (rotates as the marble rolls).
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(style.swirl, style.twoTone ? 0.95 : 0.55);
    ctx.lineWidth = r * (style.twoTone ? 0.46 : 0.3);
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, r * 0.25);
    ctx.bezierCurveTo(-r * 0.35, -r * 0.55, r * 0.3, r * 0.6, r * 0.95, -r * 0.3);
    ctx.stroke();
    ctx.lineWidth = r * (style.twoTone ? 0.22 : 0.14);
    ctx.strokeStyle = rgba(style.swirl, style.twoTone ? 0.8 : 0.4);
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.85);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.2, r * 0.2, r * 0.9);
    ctx.stroke();

    // Rim shadow for a rounded look.
    const rim = ctx.createRadialGradient(0, 0, r * 0.62, 0, 0, r);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = rim;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    return c;
  }

  private paintGloss(): HTMLCanvasElement {
    const r = this.pixelRadius;
    const size = r * 2 + 2;
    const [c, ctx] = this.canvas(size);
    ctx.translate(size / 2, size / 2);
    const g = ctx.createRadialGradient(-r * 0.38, -r * 0.42, 0, -r * 0.38, -r * 0.42, r * 0.55);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Soft bounce light at the bottom right.
    const b = ctx.createRadialGradient(r * 0.45, r * 0.5, 0, r * 0.45, r * 0.5, r * 0.5);
    b.addColorStop(0, 'rgba(255,255,255,0.28)');
    b.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  private paintGlow(colorIndex: number): HTMLCanvasElement {
    const r = this.pixelRadius;
    const R = Math.ceil(r * 2.6);
    const [c, ctx] = this.canvas(R * 2);
    const base = marbleStyle(colorIndex).base;
    const g = ctx.createRadialGradient(R, R, r * 0.6, R, R, R);
    g.addColorStop(0, rgba(base, 0.55));
    g.addColorStop(0.45, rgba(base, 0.18));
    g.addColorStop(1, rgba(base, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, R * 2, R * 2);
    return c;
  }

  /** Glow sprite radius relative to the marble radius. */
  static readonly GLOW_SCALE = 2.6;
}
