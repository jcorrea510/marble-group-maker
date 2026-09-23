/**
 * Small synthesized sound effects (no audio files). Everything is quiet by
 * design and throttled so a busy race never becomes noisy. Browsers only
 * allow sound after a click, so `unlock()` is called from the Start button.
 */
class AudioFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private lastHit = 0;
  private hitsThisSecond = 0;
  private secondStart = 0;

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  get isMuted() {
    return this.muted;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        const compressor = this.ctx.createDynamicsCompressor();
        this.master.connect(compressor).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, duration: number, opts: { type?: OscillatorType; volume?: number; slideTo?: number; delay?: number } = {}) {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + duration);
    const vol = opts.volume ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  countdown() {
    this.tone(660, 0.16, { type: 'triangle', volume: 0.22 });
  }

  go() {
    this.tone(880, 0.35, { type: 'triangle', volume: 0.22 });
    this.tone(1320, 0.4, { type: 'sine', volume: 0.12, delay: 0.02 });
  }

  /** Very soft clicks for collisions, rate limited. */
  hit(strength: number, kind: 'marble' | 'bumper' | 'other') {
    const ctx = this.ready();
    if (!ctx) return;
    const now = performance.now();
    if (now - this.secondStart > 1000) {
      this.secondStart = now;
      this.hitsThisSecond = 0;
    }
    if (now - this.lastHit < 45 || this.hitsThisSecond > 14) return;
    this.lastHit = now;
    this.hitsThisSecond++;
    const vol = Math.min(0.1, 0.012 * strength);
    if (kind === 'bumper') {
      this.tone(420 + Math.random() * 80, 0.18, { type: 'sine', volume: 0.13, slideTo: 900 });
    } else if (kind === 'marble') {
      this.tone(1800 + Math.random() * 900, 0.05, { type: 'sine', volume: vol });
    } else {
      this.tone(500 + Math.random() * 300, 0.05, { type: 'triangle', volume: vol * 0.7 });
    }
  }

  finish(position: number) {
    if (position > 12 && position % 3 !== 0) return; // keep big races calm
    const freq = position === 1 ? 1046 : Math.max(520, 988 - position * 22);
    this.tone(freq, 0.3, { type: 'sine', volume: position === 1 ? 0.2 : 0.1 });
    if (position === 1) this.tone(freq * 1.5, 0.45, { type: 'sine', volume: 0.12, delay: 0.08 });
  }

  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', volume: 0.16, delay: i * 0.1 }));
  }
}

export const audio = new AudioFx();
