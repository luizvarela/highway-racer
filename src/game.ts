import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FOG_FAR, FOG_NEAR, HEAT, HIGH_SPEED_KMH, KMH, PLAYER, SCORE } from "./config";
import { Skyline, SpeedLines } from "./environment";
import { Hud, type RunStats } from "./hud";
import { Input } from "./input";
import { Player } from "./player";
import { Police } from "./police";
import { Road } from "./road";
import { TRAFFIC_KINDS, Traffic } from "./traffic";
import { loadVehicles } from "./vehicles";

type State = "loading" | "ready" | "running" | "crashed";

const NIGHT = 0x1a0b2e;
const BEST_KEY = "highway-racer.best";
const CRASH_OVERLAY_DELAY = 1.1; // seconds of crash animation before the results panel
const MODELS_URL = `${import.meta.env.BASE_URL}models/kenney/`;

function newStats(): RunStats {
  return {
    score: 0, distanceKm: 0, topSpeedKmh: 0, highSpeedSeconds: 0,
    nearMisses: 0, bestCombo: 0, takedowns: 0, copsLost: 0, maxLevel: 1, end: "crashed",
  };
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable: best score just isn't persisted */
  }
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 1000);
  private readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0.9);
  private readonly road = new Road();
  private readonly skyline = new Skyline();
  private readonly speedLines = new SpeedLines();
  private traffic!: Traffic;
  private player!: Player;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly clock = new THREE.Clock();

  private state: State = "loading";
  private readonly police = new Police();
  private stats: RunStats = newStats();
  private highSpeedStreak = 0;
  private heat = 0;
  private combo = 0;
  private comboTimer = 0;
  private crashTimer = 0;
  private shake = 0;
  private best = loadBest();
  private manualTime = false; // tests drive the simulation in fixed steps

  static async create(container: HTMLElement): Promise<Game> {
    await loadVehicles([...TRAFFIC_KINDS.map((k) => k.kind), "sedan-sports", "police"], MODELS_URL);
    return new Game(container);
  }

  private constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(NIGHT);
    this.scene.fog = new THREE.Fog(NIGHT, FOG_NEAR, FOG_FAR);
    this.scene.add(new THREE.HemisphereLight(0x6a5cff, 0x1a0820, 0.9));

    // dim moonlight keeps a soft shadow under the cars; it follows the player
    this.moon.position.set(-20, 40, 25);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 50;
    sc.bottom = -50;
    sc.far = 140;
    this.moon.shadow.bias = -0.0005;
    this.scene.add(this.moon, this.moon.target);

    this.traffic = new Traffic();
    this.player = new Player();
    this.scene.add(this.skyline.mesh, this.road.group, this.traffic.group, this.player.object, this.police.group, this.speedLines.object);

    // bloom makes every emissive surface (lines, lamps, lights, windows) glow.
    // The composer renders off-screen, where the canvas' antialias flag does not
    // apply: without MSAA here, sub-pixel tail lights pop on/off and blink.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new Input(this.renderer.domElement);
    this.input.onAction = () => this.handleAction();
    this.hud = new Hud(() => this.handleAction());

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.reset();
    this.state = "ready";
    this.hud.showStart();

    this.camera.position.set(0, 7.2, 10);

    // read-only hook for automated smoke tests and debugging in the console
    const game = this;
    (window as unknown as { __game: unknown }).__game = {
      get state() { return game.state; },
      get speedKmh() { return game.player.speedKmh; },
      get x() { return game.player.x; },
      get stats() { return { ...game.stats }; },
      get trafficCount() { return game.traffic.activeCount; },
      get heat() { return game.heat; },
      get level() { return game.level; },
      get bust() { return game.police.bust; },
      get cops() { return game.police.snapshot(); },
      get obstacles() { return game.traffic.obstacles(); },
      /** test-only: stop real-time simulation and advance it in fixed 1/60 s steps */
      advance(seconds: number) {
        game.manualTime = true;
        for (let i = 0; i < Math.round(seconds * 60); i++) game.simulate(1 / 60);
      },
    };

    this.renderer.setAnimationLoop(() => this.frame());
  }

  private handleAction(): void {
    if (this.state === "ready") this.start();
    else if (this.state === "crashed" && this.crashTimer >= CRASH_OVERLAY_DELAY) {
      this.reset();
      this.start();
    }
  }

  private reset(): void {
    this.player.reset();
    this.traffic.reset();
    this.police.reset();
    this.stats = newStats();
    this.heat = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.highSpeedStreak = 0;
    this.crashTimer = 0;
    this.shake = 0;
  }

  private start(): void {
    this.state = "running";
    this.hud.showRunning(this.best);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    // bloom at half resolution: looks the same, costs a quarter
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // portrait phones need a wider view to see the lanes
    this.camera.userData.baseFov = this.camera.aspect < 1 ? 78 : 62;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (!this.manualTime) this.simulate(dt);
    this.composer.render();
  }

  private simulate(dt: number): void {
    const input = this.input.read(dt);
    let dz = 0;

    if (this.state === "running" || this.state === "crashed") {
      this.player.update(dt, input);
      dz = this.player.speed * dt;
      this.road.update(dz);
      this.traffic.update(dt, this.player.speed, this.stats.distanceKm);
      const p = this.player;
      const ev = this.police.update(
        dt,
        { x: p.x, speed: p.speed, halfWidth: p.halfWidth, halfLength: p.halfLength },
        this.level,
        this.traffic.obstacles(),
        this.state === "running",
      );
      if (this.state === "running") this.policeEvents(ev);
    }

    if (this.state === "running") {
      this.updateRun(dt);
    } else if (this.state === "crashed") {
      const before = this.crashTimer;
      this.crashTimer += dt;
      if (before < CRASH_OVERLAY_DELAY && this.crashTimer >= CRASH_OVERLAY_DELAY) {
        const isBest = Math.floor(this.stats.score) > this.best;
        if (isBest) {
          this.best = Math.floor(this.stats.score);
          saveBest(this.best);
        }
        this.hud.showCrash(this.stats, isBest);
      }
    }

    if (this.state !== "ready") {
      this.hud.update(this.stats, this.player.speedKmh, this.highSpeedStreak);
      if (this.state === "running") this.hud.updateChase(this.heat, this.level, this.police.bust, this.police.nearest, this.combo, this.comboTimer);
    }
    const speedT = this.speedT();
    this.speedLines.update(speedT, dz, this.player.x);
    this.updateCamera(dt, speedT);
  }

  /** Wanted level 1..5 from heat. */
  private get level(): number {
    return Math.min(5, 1 + Math.floor(this.heat / HEAT.perLevel));
  }

  private policeEvents(ev: { takedowns: number; lost: number; bumpSide: number }): void {
    if (ev.takedowns) {
      this.stats.takedowns += ev.takedowns;
      this.stats.score += SCORE.takedown * ev.takedowns;
      this.heat += HEAT.takedown * ev.takedowns;
      this.hud.popup(`TAKEDOWN +${SCORE.takedown * ev.takedowns}`, "takedown");
    }
    if (ev.lost) {
      this.stats.copsLost += ev.lost;
      this.stats.score += SCORE.copLost * ev.lost;
      this.hud.popup(`COP LOST +${SCORE.copLost * ev.lost}`, "lost");
    }
    if (ev.bumpSide) {
      this.player.bump(ev.bumpSide);
      this.shake = Math.max(this.shake, 0.25);
    }
  }

  private end(reason: RunStats["end"]): void {
    this.stats.end = reason;
    this.state = "crashed";
    this.highSpeedStreak = 0;
    this.combo = 0;
  }

  private speedT(): number {
    const min = PLAYER.minSpeedKmh * KMH;
    const max = PLAYER.maxSpeedKmh * KMH;
    return THREE.MathUtils.clamp((this.player.speed - min) / (max - min), 0, 1);
  }

  private updateRun(dt: number): void {
    const p = this.player;
    const kmh = p.speedKmh;
    const metres = p.speed * dt;
    this.stats.distanceKm += metres / 1000;
    this.stats.topSpeedKmh = Math.max(this.stats.topSpeedKmh, kmh);

    // score: distance, weighted by speed; bonus while above HIGH_SPEED_KMH
    this.stats.score += metres * 0.1 * (kmh / 100);
    if (kmh >= HIGH_SPEED_KMH) {
      this.highSpeedStreak += dt;
      this.stats.highSpeedSeconds += dt;
      this.stats.score += dt * 5;
    } else {
      this.highSpeedStreak = 0;
    }

    // heat builds on its own and faster when driving flat out
    this.heat += dt * (HEAT.perSecond + (kmh >= HEAT.fastKmh ? HEAT.perSecondFast : 0));

    // near misses chain into a combo while they keep coming
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    const misses = this.traffic.nearMisses(p.x, p.halfWidth);
    for (let i = 0; i < misses; i++) {
      this.combo++;
      this.comboTimer = SCORE.comboWindow;
      this.stats.nearMisses++;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      this.stats.score += SCORE.nearMiss * this.combo;
      this.heat += HEAT.nearMiss;
      this.hud.popup(`NEAR MISS${this.combo > 1 ? ` x${this.combo}` : ""} +${SCORE.nearMiss * this.combo}`, "near");
    }
    this.stats.maxLevel = Math.max(this.stats.maxLevel, this.level);

    const side = this.traffic.collide({ x: p.x, z: 0, halfWidth: p.halfWidth * 0.95, halfLength: p.halfLength * 0.95 });
    if (side !== 0) {
      p.crash(side);
      this.shake = 0.6;
      this.end("crashed");
    } else if (this.police.bust >= 1) {
      p.pullOver();
      this.end("busted");
    }
  }

  private updateCamera(dt: number, speedT: number): void {
    const p = this.player;
    const cam = this.camera;

    // pull back when a cop is on our tail, so it is in view behind the car
    const cop = this.police.nearest;
    const chase = cop === null ? 0 : THREE.MathUtils.clamp(1 - (cop - 6) / 30, 0, 1);
    const targetX = p.x * 0.75;
    const camZ = 10 + speedT * 1.5 + chase * 5;
    const camY = 7.2 - speedT * 0.8 + chase * 1.3;
    const k = 1 - Math.exp(-6 * dt);
    cam.position.x += (targetX - cam.position.x) * k;
    cam.position.y += (camY - cam.position.y) * k;
    cam.position.z += (camZ - cam.position.z) * k;

    const baseFov = (cam.userData.baseFov as number) ?? 62;
    const fov = baseFov + speedT * 16;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * k;
      cam.updateProjectionMatrix();
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(p.x * 0.85, 0, -22);

    this.skyline.follow(cam.position.x);
    this.moon.position.set(p.x - 20, 40, 25);
    this.moon.target.position.set(p.x, 0, -15);
  }
}
