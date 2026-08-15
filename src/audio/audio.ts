/**
 * Lightweight procedural sound. Everything is synthesised on demand with
 * oscillators and a shared noise buffer - no assets, no loading.
 */

type SfxName =
  | 'select'
  | 'command'
  | 'place'
  | 'build'
  | 'complete'
  | 'train'
  | 'research'
  | 'gather'
  | 'deposit'
  | 'swing'
  | 'bow'
  | 'impact'
  | 'death'
  | 'destroy'
  | 'warning'
  | 'deny'
  | 'ageup'
  | 'victory'
  | 'defeat'
  | 'ui';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.55;
  /** Rate limiting so battles don't turn into a wall of noise. */
  private lastPlayed = new Map<SfxName, number>();
  private started = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture on iOS/Safari. */
  unlock(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  private canPlay(name: SfxName, minGap: number): boolean {
    if (!this.ctx || !this.master || this.muted) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -99;
    if (now - last < minGap) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private tone(
    freq: number,
    duration: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      delay?: number;
      slideTo?: number;
      attack?: number;
      pan?: number;
    } = {},
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + duration);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private burst(
    duration: number,
    opts: { gain?: number; delay?: number; filter?: number; q?: number; sweepTo?: number; type?: BiquadFilterType } = {},
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.filter ?? 900, t0);
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), t0 + duration);
    filter.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  play(name: SfxName): void {
    switch (name) {
      case 'select':
        if (!this.canPlay(name, 0.05)) return;
        this.tone(720, 0.07, { type: 'square', gain: 0.11 });
        this.tone(1080, 0.05, { type: 'sine', gain: 0.07, delay: 0.02 });
        break;
      case 'command':
        if (!this.canPlay(name, 0.05)) return;
        this.tone(430, 0.09, { type: 'triangle', gain: 0.13, slideTo: 640 });
        break;
      case 'ui':
        if (!this.canPlay(name, 0.03)) return;
        this.tone(560, 0.05, { type: 'square', gain: 0.08 });
        break;
      case 'place':
        if (!this.canPlay(name, 0.08)) return;
        this.burst(0.16, { gain: 0.16, filter: 700, sweepTo: 220 });
        this.tone(220, 0.14, { type: 'sine', gain: 0.14 });
        break;
      case 'build':
        if (!this.canPlay(name, 0.42)) return;
        this.burst(0.07, { gain: 0.07, filter: 1800, q: 2.2 });
        this.tone(320, 0.06, { type: 'square', gain: 0.05 });
        break;
      case 'complete':
        if (!this.canPlay(name, 0.15)) return;
        this.tone(523, 0.12, { type: 'triangle', gain: 0.16 });
        this.tone(659, 0.14, { type: 'triangle', gain: 0.15, delay: 0.09 });
        this.tone(784, 0.2, { type: 'triangle', gain: 0.14, delay: 0.18 });
        break;
      case 'train':
        if (!this.canPlay(name, 0.1)) return;
        this.tone(392, 0.1, { type: 'triangle', gain: 0.12 });
        this.tone(587, 0.12, { type: 'triangle', gain: 0.1, delay: 0.07 });
        break;
      case 'research':
        if (!this.canPlay(name, 0.2)) return;
        this.tone(330, 0.5, { type: 'sine', gain: 0.13, slideTo: 660 });
        break;
      case 'gather':
        if (!this.canPlay(name, 0.3)) return;
        this.burst(0.06, { gain: 0.05, filter: 2400, q: 3 });
        break;
      case 'deposit':
        if (!this.canPlay(name, 0.22)) return;
        this.tone(880, 0.07, { type: 'sine', gain: 0.08 });
        this.tone(1180, 0.08, { type: 'sine', gain: 0.06, delay: 0.05 });
        break;
      case 'swing':
        if (!this.canPlay(name, 0.07)) return;
        this.burst(0.1, { gain: 0.11, filter: 1500, sweepTo: 400, q: 0.9 });
        break;
      case 'bow':
        if (!this.canPlay(name, 0.07)) return;
        this.burst(0.08, { gain: 0.08, filter: 3200, sweepTo: 1200, q: 2 });
        break;
      case 'impact':
        if (!this.canPlay(name, 0.06)) return;
        this.burst(0.09, { gain: 0.13, filter: 500, sweepTo: 150, type: 'lowpass' });
        this.tone(150, 0.09, { type: 'square', gain: 0.07 });
        break;
      case 'death':
        if (!this.canPlay(name, 0.2)) return;
        this.tone(260, 0.28, { type: 'sawtooth', gain: 0.09, slideTo: 90 });
        break;
      case 'destroy':
        if (!this.canPlay(name, 0.25)) return;
        this.burst(0.75, { gain: 0.26, filter: 420, sweepTo: 90, type: 'lowpass' });
        this.tone(90, 0.55, { type: 'square', gain: 0.16, slideTo: 42 });
        break;
      case 'warning':
        if (!this.canPlay(name, 3)) return;
        this.tone(660, 0.16, { type: 'square', gain: 0.14 });
        this.tone(560, 0.2, { type: 'square', gain: 0.14, delay: 0.2 });
        this.tone(660, 0.24, { type: 'square', gain: 0.14, delay: 0.42 });
        break;
      case 'deny':
        if (!this.canPlay(name, 0.15)) return;
        this.tone(200, 0.16, { type: 'square', gain: 0.13, slideTo: 120 });
        break;
      case 'ageup':
        if (!this.canPlay(name, 1)) return;
        [392, 494, 587, 784].forEach((f, i) =>
          this.tone(f, 0.5, { type: 'triangle', gain: 0.15, delay: i * 0.14 }),
        );
        break;
      case 'victory':
        if (!this.canPlay(name, 3)) return;
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone(f, 0.8, { type: 'triangle', gain: 0.18, delay: i * 0.17 }),
        );
        this.tone(261, 1.6, { type: 'sine', gain: 0.12, delay: 0.5 });
        break;
      case 'defeat':
        if (!this.canPlay(name, 3)) return;
        [440, 392, 330, 262].forEach((f, i) =>
          this.tone(f, 0.9, { type: 'sine', gain: 0.16, delay: i * 0.26 }),
        );
        break;
    }
  }
}

export const audio = new AudioEngine();
export type { SfxName };
