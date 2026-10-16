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

/** iOS 17+ audio session type; older browsers don't have it. */
function setSessionType(type: "playback" | "ambient"): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    /* older Safari: the silent switch mutes web audio */
  }
}

const MUSIC_URL = `${import.meta.env.BASE_URL}audio/neon-city-run.mp3${typeof __BUILD__ === "string" ? `?v=${__BUILD__}` : ""}`;
const MUSIC = { menu: 0.45, drive: 0.32 }; // music volume (master is 0.8)

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
  // music: streamed from an <audio> element into the graph, so mute, the
  // portal's mute and ads silence it with everything else
  private music: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicMode: "menu" | "drive" = "menu";
  private muted: boolean; // the player's toggle
  private forced = false; // the portal asks for silence (its own mute setting)
  private adPlaying = false;
  private resumeTriedAt = 0; // when a gesture last tried to resume a stopped context
  /** recent audio events, for the ?debug overlay */
  readonly log: string[] = [];

  private note(msg: string): void {
    const t = (performance.now() / 1000).toFixed(1);
    this.log.push(`${t}s ${msg}`);
    if (this.log.length > 6) this.log.shift();
  }

  constructor(muted: boolean) {
    this.muted = muted;
    // Leaving the page must silence everything. iOS keeps a "playback" audio
    // session (and a playing <audio> element) alive in the background, so stop
    // on every way out and drop to "ambient", which iOS never plays in the background.
    const away = () => {
      this.music?.pause();
      setSessionType("ambient");
      void this.ctx?.suspend();
      this.note("page hidden: paused");
    };
    const back = () => {
      if (document.hidden || !this.ctx) return;
      setSessionType("playback");
      void this.ctx.resume();
      this.playMusic();
    };
    document.addEventListener("visibilitychange", () => (document.hidden ? away() : back()));
    window.addEventListener("pagehide", away);
    document.addEventListener("freeze", away);
    window.addEventListener("pageshow", back);
    // no lock-screen / control-centre play button for the game's music
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (ms) {
      for (const action of ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
        try {
          ms.setActionHandler(action, () => {});
        } catch {
          /* action not supported */
        }
      }
    }
  }

  /** test-only: stop the context the way an iOS interruption does */
  interruptForTest(): void {
    void this.ctx?.suspend();
  }

  /** for tests: context state, master volume and what is silencing it */
  get state(): string {
    if (!this.ctx) return "none";
    return `${this.ctx.state} master=${this.master.gain.value.toFixed(2)} engine=${this.engGain.gain.value.toFixed(3)}` +
      ` muted=${this.muted} forced=${this.forced} ad=${this.adPlaying}`;
  }

  private get silent(): boolean {
    return this.muted || this.forced || this.adPlaying;
  }

  private applyVolume(): void {
    if (this.ctx) this.master.gain.setTargetAtTime(this.silent ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  setForcedMute(m: boolean): void {
    this.forced = m;
    this.applyVolume();
  }

  /** silence everything while an ad plays */
  setAdPlaying(on: boolean): void {
    this.adPlaying = on;
    this.applyVolume();
  }

  /** Create or resume the audio graph; call from a click/key handler. */
  unlock(): void {
    if (document.hidden) return;
    const ctx = this.ctx;
    if (ctx && ctx.state === "running") {
      this.resumeTriedAt = 0;
      if (this.music?.paused) this.playMusic(); // a refused play() gets another go on each gesture
      return;
    }
    if (ctx && ctx.state !== "closed") {
      // "suspended", or "interrupted" on iOS (an ad's video, a call, another app's
      // audio). Try to resume first; if a resume from an earlier gesture still
      // hasn't worked, iOS can leave the context stuck for good: replace it.
      const stuck = this.resumeTriedAt > 0 && performance.now() - this.resumeTriedAt > 500;
      if (!stuck) {
        if (!this.resumeTriedAt) this.resumeTriedAt = performance.now();
        this.note(`resume from ${ctx.state}`);
        void ctx.resume().catch((e) => this.note(`resume failed: ${e}`));
        this.kick(ctx);
        return;
      }
      this.note(`stuck ${ctx.state}: new context`);
      void ctx.close().catch(() => {});
    }
    this.resumeTriedAt = 0;
    this.open();
  }

  /** Build a fresh context and the whole graph (inside a user gesture). */
  private open(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    // iOS 17+: play through the ring/silent switch like a game or video, not like a notification
    setSessionType("playback");
    const ctx = (this.ctx = new Ctx());
    ctx.onstatechange = () => this.note(`state ${ctx.state}`);
    this.note(`opened (${ctx.state})`);
    if (ctx.state !== "running") void ctx.resume();
    this.kick(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = this.silent ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.openMusic(ctx);

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

  /** A fresh element per context: an element can only ever feed one context. */
  private openMusic(ctx: AudioContext): void {
    this.music?.pause();
    const el = new Audio(MUSIC_URL);
    el.loop = true;
    el.preload = "auto";
    this.music = el;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicGain = ctx.createGain();
    this.applyMusicMode(true);
    try {
      ctx.createMediaElementSource(el).connect(this.musicFilter).connect(this.musicGain).connect(this.master);
    } catch (e) {
      this.note(`music not routed: ${e}`);
    }
    this.playMusic();
  }

  private playMusic(): void {
    const el = this.music;
    if (!el || document.hidden) return;
    el.muted = false;
    void el.play().catch((e) => this.note(`music: ${e}`));
  }

  /** Menus: the track muffled and softer. Driving: open and full, under the engine. */
  setMusicMode(mode: "menu" | "drive"): void {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this.applyMusicMode(false);
  }

  private applyMusicMode(now: boolean): void {
    if (!this.ctx || !this.musicGain || !this.musicFilter) return;
    const drive = this.musicMode === "drive";
    const t = this.ctx.currentTime;
    const ramp = now ? 0.01 : 0.6;
    this.musicGain.gain.setTargetAtTime(drive ? MUSIC.drive : MUSIC.menu, t, ramp);
    this.musicFilter.frequency.setTargetAtTime(drive ? 16000 : 1100, t, ramp);
  }

  /** Dip the music under a big sound effect. */
  private duckMusic(seconds: number): void {
    if (!this.ctx || !this.musicGain) return;
    const g = this.musicGain.gain;
    const t = this.ctx.currentTime;
    const level = this.musicMode === "drive" ? MUSIC.drive : MUSIC.menu;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(level * 0.25, t, 0.03);
    g.setTargetAtTime(level, t + seconds, 0.5);
  }

  /** for tests */
  get musicState(): string {
    const el = this.music;
    if (!el) return "none";
    return `${el.paused ? "paused" : "playing"} t=${el.currentTime.toFixed(1)} mode=${this.musicMode} gain=${this.musicGain?.gain.value.toFixed(2)} lp=${Math.round(this.musicFilter?.frequency.value ?? 0)}`;
  }

  /** Older iOS only unlocks audio once a sound starts inside the gesture: play one silent sample. */
  private kick(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* nothing to unlock */
    }
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
    this.duckMusic(1.4);
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
