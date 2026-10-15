// Procedural sound with WebAudio: engine, wind, siren, helicopter and
// one-shot effects, all synthesised (no audio files to license or load).
// Browsers only allow audio after a user gesture, so call unlock() from one.

const GEARS = [0, 55, 95, 135, 175, 215, 400]; // km/h where each gear tops out

export interface SoundFrame {
  speedKmh: number;
  throttle: number; // 0..1
  driving: boolean; // engine under load (running), idling otherwise
  siren: number; // 0..1 closeness of the nearest cop
  heli: number; // 0..1
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private sirenOsc!: OscillatorNode;
  private sirenGain!: GainNode;
  private heliGain!: GainNode;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Create or resume the audio graph; call from a click/key handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // engine: sawtooth plus a square an octave down, through a lowpass that opens with revs
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engA = ctx.createOscillator();
    this.engA.type = "sawtooth";
    this.engB = ctx.createOscillator();
    this.engB.type = "square";
    const bGain = ctx.createGain();
    bGain.gain.value = 0.5;
    this.engA.connect(this.engFilter);
    this.engB.connect(bGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engA.start();
    this.engB.start();

    // wind / tyre roar grows with speed
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // siren: a wailing triangle, its pitch swept by a slow LFO
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = "triangle";
    this.sirenOsc.frequency.value = 900;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.45;
    const depth = ctx.createGain();
    depth.gain.value = 320;
    lfo.connect(depth).connect(this.sirenOsc.frequency);
    const sirenBand = ctx.createBiquadFilter();
    sirenBand.type = "bandpass";
    sirenBand.frequency.value = 1000;
    sirenBand.Q.value = 0.8;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(sirenBand).connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
    lfo.start();

    // helicopter: low noise chopped by an 11 Hz LFO
    const heliLow = ctx.createBiquadFilter();
    heliLow.type = "lowpass";
    heliLow.frequency.value = 260;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const chopLfo = ctx.createOscillator();
    chopLfo.frequency.value = 11;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.5;
    chopLfo.connect(chopDepth).connect(chop.gain);
    chopLfo.start();
    this.heliGain = ctx.createGain();
    this.heliGain.gain.value = 0;
    this.loopNoise().connect(heliLow).connect(chop).connect(this.heliGain).connect(this.master);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  update(f: SoundFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const v = Math.max(0, f.speedKmh);
    let g = 1;
    while (g < GEARS.length - 1 && v > GEARS[g]) g++;
    const rev = Math.min(1, (v - GEARS[g - 1]) / (GEARS[g] - GEARS[g - 1]));
    const rpm = f.driving ? 0.3 + 0.7 * rev : 0.12;
    const base = 38 + rpm * 115 + g * 4;
    this.engA.frequency.setTargetAtTime(base, now, 0.04);
    this.engB.frequency.setTargetAtTime(base / 2, now, 0.04);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 1500 + f.throttle * 500, now, 0.05);
    this.engGain.gain.setTargetAtTime(f.driving ? 0.05 + f.throttle * 0.035 : 0.025, now, 0.1);

    const t = Math.min(1, v / 250);
    this.windFilter.frequency.setTargetAtTime(500 + t * 1500, now, 0.1);
    this.windGain.gain.setTargetAtTime(f.driving ? t * t * 0.09 : 0, now, 0.2);
    this.sirenGain.gain.setTargetAtTime(f.siren * 0.05, now, 0.15);
    this.heliGain.gain.setTargetAtTime(f.heli * 0.35, now, 0.4);
  }

  /** Silence the loops (engine idle stays) between runs. */
  quiet(): void {
    this.update({ speedKmh: 0, throttle: 0, driving: false, siren: 0, heli: 0 });
  }

  // ---- one-shots ----

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  nearMiss(): void {
    this.burst(0.28, "bandpass", 500, 2600, 0.35);
  }

  crash(): void {
    this.burst(0.9, "lowpass", 4000, 150, 0.9);
    this.tone(70, 0.45, "sine", 0.7, 0, 35);
    for (let i = 0; i < 4; i++) this.tone(300 + Math.random() * 700, 0.12, "square", 0.06, 0.05 + i * 0.07);
  }

  takedown(): void {
    this.burst(0.6, "lowpass", 3000, 200, 0.5);
    this.tone(60, 0.3, "sine", 0.4, 0, 35);
    this.tone(880, 0.15, "square", 0.08, 0.12);
    this.tone(1320, 0.25, "square", 0.08, 0.22);
  }

  bump(): void {
    this.burst(0.18, "lowpass", 900, 200, 0.5);
    this.tone(90, 0.15, "sine", 0.35, 0, 50);
  }

  spikes(): void {
    for (let i = 0; i < 10; i++) this.burst(0.03, "highpass", 3000, 2000, 0.3, i * 0.035);
    this.burst(1.2, "highpass", 5000, 1500, 0.25, 0.1); // the tyres going down
  }

  multiplier(level: number): void {
    const root = 440 * Math.pow(2, (level - 2) / 6);
    [1, 1.25, 1.5].forEach((m, i) => this.tone(root * m, 0.14, "square", 0.07, i * 0.06));
  }

  escape(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.18, i * 0.08));
  }

  roadblock(): void {
    this.tone(660, 0.12, "square", 0.08);
    this.tone(990, 0.25, "square", 0.08, 0.09);
  }

  warning(): void {
    this.tone(1250, 0.09, "square", 0.06);
    this.tone(1250, 0.09, "square", 0.06, 0.16);
  }

  buy(): void {
    this.tone(988, 0.08, "square", 0.08);
    this.tone(1319, 0.3, "square", 0.08, 0.08);
  }

  click(): void {
    this.tone(600, 0.04, "square", 0.05);
  }
}
