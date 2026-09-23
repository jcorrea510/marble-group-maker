/**
 * Lightweight particle effects in world coordinates: sparks on impacts,
 * shock rings on bumpers and confetti at the finish.
 */
interface Particle {
  kind: 'spark' | 'confetti' | 'ring' | 'text';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  text?: string;
}

const MAX_PARTICLES = 700;

export class Particles {
  private list: Particle[] = [];

  get count() {
    return this.list.length;
  }

  private push(p: Particle) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  sparks(x: number, y: number, color: string, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.3,
        size: 1.6 + Math.random() * 2,
        color,
        rot: 0,
        vr: 0,
      });
    }
  }

  ring(x: number, y: number, color: string, radius: number) {
    this.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0, maxLife: 0.45, size: radius, color, rot: 0, vr: 0 });
  }

  confetti(x: number, y: number, colors: string[], count: number, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = (220 + Math.random() * 380) * power;
      this.push({
        kind: 'confetti',
        x: x + (Math.random() - 0.5) * 30,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        maxLife: 1.2 + Math.random() * 1.1,
        size: 5 + Math.random() * 6,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
      });
    }
  }

  floatingText(x: number, y: number, text: string, color: string) {
    this.push({ kind: 'text', x, y, vx: 0, vy: -70, life: 0, maxLife: 1.5, size: 1, color, rot: 0, vr: 0, text });
  }

  update(dt: number) {
    const gravity = 900;
    for (const p of this.list) {
      p.life += dt;
      if (p.kind === 'spark') {
        p.vy += gravity * 0.5 * dt;
        p.vx *= 0.96;
      } else if (p.kind === 'confetti') {
        p.vy += gravity * 0.55 * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.rot += p.vr * dt;
      } else if (p.kind === 'text') {
        p.vy *= 0.96;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life < p.maxLife);
  }

  /** Draw in world coordinates (the camera transform is already applied). */
  draw(ctx: CanvasRenderingContext2D, top: number, bottom: number, textScale: number) {
    for (const p of this.list) {
      if (p.y < top - 100 || p.y > bottom + 100) continue;
      const t = p.life / p.maxLife;
      const alpha = 1 - t;
      if (p.kind === 'spark') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + t * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.globalAlpha = Math.min(1, alpha * 1.5);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.rot * 1.7)) + 1);
        ctx.restore();
      } else if (p.kind === 'text' && p.text) {
        ctx.globalAlpha = Math.min(1, alpha * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(textScale, textScale);
        ctx.font = `800 18px "Bricolage Grotesque Variable", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.list = [];
  }
}
