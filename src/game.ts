import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CARS, carById, carStats, cashForScore, nextGoal } from "./cars";
import { applyRun, claimDaily, dailyOffer, drawMission, fillMissions, liveViews, setDateOverride, today, viewMission } from "./missions";
import { Sound } from "./audio";
import { ADS, ESCAPE, FOG_FAR, FOG_NEAR, HAZARDS, HEAT, HIGH_SPEED_KMH, KMH, PLAYER, SCORE } from "./config";
import { DEBRIS_KINDS, Debris } from "./debris";
import { Skyline, SpeedLines } from "./environment";
import { Garage } from "./garage";
import { Hazards } from "./hazards";
import { Helicopter } from "./helicopter";
import { Hud, type RunStats } from "./hud";
import { Input } from "./input";
import { Player } from "./player";
import { Police } from "./police";
import { Road } from "./road";
import type { AdResult, Portal } from "./portal";
import { loadSave, writeSave, type SaveData } from "./save";
import { Scoring } from "./scoring";
import { TRAFFIC_KINDS, Traffic } from "./traffic";
import { loadProps, loadVehicles } from "./vehicles";

type State = "loading" | "ready" | "garage" | "running" | "crashed";

const NIGHT = 0x1a0b2e;
const MAX_STEP_HZ = 120; // physics steps per second at least, whatever the display rate
const CRASH_OVERLAY_DELAY = 1.1; // seconds of crash animation before the results panel
const MODELS_URL = `${import.meta.env.BASE_URL}models/kenney/`;

function newStats(): RunStats {
  return {
    score: 0, distanceKm: 0, topSpeedKmh: 0, highSpeedSeconds: 0,
    nearMisses: 0, bestCombo: 0, bestMultiplier: 1, takedowns: 0, copsLost: 0, escapes: 0, roadblocks: 0, maxLevel: 1,
    points: { driving: 0, nearMiss: 0, takedown: 0, copLost: 0, escape: 0, roadblock: 0 },
    end: "crashed",
  };
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
  private readonly scoring = new Scoring();
  private heat = 0;
  private pursuit = false; // a cop has been close since the last escape
  private evade = 0; // 0..1 progress towards escaping
  private crashTimer = 0;
  private shake = 0;
  private readonly save: SaveData;
  private readonly garage: Garage;
  private garageAngle = 0;
  // showroom light over the parked car; intensity 0 outside the garage so the
  // light count (and with it every shader) never changes
  private readonly showroom = new THREE.SpotLight(0xffffff, 0, 30, 0.6, 0.5, 1);
  private manualTime = false; // tests drive the simulation in fixed steps
  private readonly hazards: Hazards;
  private readonly heli = new Helicopter();
  private readonly debris: Debris;
  private readonly sound: Sound;
  private adBusy = false; // an ad is being requested or playing: simulation and input on hold
  private playSeconds = 0; // gameplay this session, for ad pacing
  private playAtLastAd = -Infinity; // no ad yet: the first one only waits for ADS.firstAfterSeconds
  private lastEarned = 0;
  private doubled = false;
  private celebrated = false;
  private hinted = false;
  private hintTime = -1; // seconds of driving since the hint appeared; -1 = not showing
  private hintSkip = false; // a key or tap asked to skip it
  private missionCheck = 0; // seconds until the next live mission check
  private missionDoneShown = new Set<number>();
  private hazardWarned = false; // the warning beep plays once per hazard

  static async create(container: HTMLElement, portal: Portal): Promise<Game> {
    await loadVehicles([...TRAFFIC_KINDS.map((k) => k.kind), ...CARS.map((c) => c.model), "police"], MODELS_URL);
    await loadProps(["cone", ...DEBRIS_KINDS], MODELS_URL); // props are scaled from the loaded sedan
    return new Game(container, portal);
  }

  private constructor(container: HTMLElement, private readonly portal: Portal) {
    this.save = loadSave(portal.storage);
    fillMissions(this.save.missions, this.save.missionsDone);
    this.sound = new Sound(this.save.muted);
    portal.onForcedMute((m) => this.sound.setForcedMute(m));
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
    this.showroom.position.set(2, 9, 4);
    this.scene.add(this.showroom, this.showroom.target);

    this.traffic = new Traffic();
    this.player = new Player();
    this.useSelectedCar();
    this.hazards = new Hazards(this.police.barMats);
    this.debris = new Debris();
    this.scene.add(
      this.skyline.mesh, this.road.group, this.traffic.group, this.player.object, this.police.group, this.speedLines.object,
      this.hazards.group, this.heli.group, this.debris.group,
    );

    // bloom makes every emissive surface (lines, lamps, lights, windows) glow.
    // The composer renders off-screen, where the canvas' antialias flag does not
    // apply: without MSAA here, sub-pixel tail lights pop on/off and blink.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new Input();
    this.input.onAction = () => this.handleAction();
    this.hud = new Hud({
      onStart: () => this.handleAction(),
      onGarage: (carId) => this.openGarage(carId),
      onMute: () => this.toggleMute(),
      onDouble: () => void this.doubleCash(),
      onDaily: () => this.claimDailyBonus(),
      onSwap: (i) => this.swapMission(i),
    });
    this.hud.setMuted(this.save.muted);
    // browsers only start audio from a user gesture
    // Safari only treats some events as permission to play (touchend/click, not
    // touchstart/pointerdown), so try on all of them; capture phase so the
    // touch controls' preventDefault can't swallow them
    const unlock = () => this.sound.unlock();
    for (const type of ["pointerdown", "pointerup", "touchend", "click"]) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    window.addEventListener("keydown", (e) => {
      unlock();
      if (e.code === "KeyM" && !e.repeat) this.toggleMute();
    });
    const game = this;
    this.garage = new Garage({
      save: this.save,
      preview: (car, stats) => this.player.setCar(car, stats),
      commit: () => writeSave(this.portal.storage, this.save),
      purchased: () => this.sound.buy(),
      drive: () => {
        this.closeGarage();
        this.start();
      },
      back: () => {
        this.closeGarage();
        this.state = "ready";
        this.showStart();
      },
    });

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.reset();
    this.state = "ready";
    this.showStart();

    this.camera.position.set(0, 7.2, 10);

    // read-only hook for automated smoke tests and debugging in the console
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
      get multiplier() { return game.scoring.multiplier; },
      get evade() { return game.evade; },
      get hazards() { return game.hazards.snapshot(); },
      get portal() { return game.portal.name; },
      get audio() { return game.sound.state; },
      get missions() { return liveViews(game.save.missions, game.stats); },
      /** test-only: set the date missions/daily use (YYYY-MM-DD); "" = real clock */
      setDate(d: string) { setDateOverride(d); },
      get audioLog() { return game.sound.log.join(" | "); },
      /** test-only: suspend audio like an iOS interruption */
      interruptAudio() { game.sound.interruptForTest(); },
      get adBusy() { return game.adBusy; },
      get playSeconds() { return game.playSeconds; },
      /** test-only: pretend this much gameplay happened this session (ad pacing) */
      setPlaySeconds(v: number) { game.playSeconds = v; },
      get tiresBlown() { return game.player.tiresBlown; },
      get heliWatching() { return game.heli.watching; },
      /** test-only: raise the wanted level */
      setHeat(h: number) { game.heat = h; },
      /** test-only: put a hazard on the road ahead (lane: 0..3, or the player's for spikes) */
      spawnHazard(kind: "spikes" | "roadblock", distance: number, lane = Math.round(game.player.x / 3.6 + 1.5)) {
        return game.hazards.spawn(kind, lane, distance);
      },
      get save() { return JSON.parse(JSON.stringify(game.save)); },
      get obstacles() { return [...game.traffic.obstacles(), ...game.hazards.obstacles()]; },
      /** test-only: stop real-time simulation and advance it in fixed 1/hz s steps (default 60 Hz) */
      advance(seconds: number, hz = 60) {
        game.manualTime = true;
        for (let i = 0; i < Math.round(seconds * hz); i++) game.step(1 / hz);
      },
    };

    // ?debug: live audio state in a corner, to diagnose sound on real phones
    if (new URLSearchParams(location.search).has("debug")) {
      const box = document.createElement("pre");
      box.id = "debug-audio";
      document.body.appendChild(box);
      setInterval(() => {
        box.textContent = `audio: ${this.sound.state}\n${this.sound.log.join("\n")}`;
      }, 300);
    }

    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Called once loading is done: straight into the first run where the portal wants that. */
  begin(): void {
    if (this.portal.landInGameplay && this.state === "ready") this.start();
  }

  private handleAction(): void {
    if (this.adBusy) return;
    if (this.state === "ready") this.start();
    else if (this.state === "garage") this.garage.driveIfOwned();
    else if (this.state === "crashed" && this.crashTimer >= CRASH_OVERLAY_DELAY) {
      this.reset();
      this.start();
    }
  }

  private reset(): void {
    this.player.reset();
    this.traffic.reset();
    this.police.reset();
    this.hazards.reset();
    this.heli.reset();
    this.debris.reset();
    this.hazardWarned = false;
    this.missionCheck = 0;
    this.missionDoneShown.clear();
    this.stats = newStats();
    this.scoring.reset();
    this.heat = 0;
    this.pursuit = false;
    this.evade = 0;
    this.highSpeedStreak = 0;
    this.crashTimer = 0;
    this.shake = 0;
  }

  private toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.sound.setMuted(this.save.muted);
    this.hud.setMuted(this.save.muted);
    writeSave(this.portal.storage, this.save);
  }

  private start(): void {
    if (!this.hinted) {
      this.hinted = true; // first run of the session: show the controls for a few seconds
      this.hud.showHint();
      this.hintTime = 0;
      this.hintSkip = false;
      const skip = () => {
        this.hintSkip = true;
        window.removeEventListener("keydown", skip);
        window.removeEventListener("pointerdown", skip);
      };
      window.addEventListener("keydown", skip);
      window.addEventListener("pointerdown", skip);
    }
    this.portal.gameplayStart();
    this.state = "running";
    document.body.classList.add("driving");
    this.hud.showRunning(this.save.best);
  }

  private showStart(): void {
    this.hud.showStart(carById(this.save.selected).name, this.save.cash);
    this.hud.showMissions(this.save.missions.map(viewMission), this.canSwap);
    this.showProgressCards();
  }

  /** Daily bonus and next-car goal, on both menu screens. */
  private showProgressCards(): void {
    this.hud.showDaily(dailyOffer(this.save.daily));
    this.hud.showGoal(nextGoal(this.save.cash, this.save.cars, this.save.selected));
    this.hud.setCash(this.save.cash);
  }

  private claimDailyBonus(): void {
    const cash = claimDaily(this.save.daily);
    if (cash <= 0) return;
    this.save.cash += cash;
    writeSave(this.portal.storage, this.save);
    this.hud.dailyClaimed(cash);
    this.hud.showGoal(nextGoal(this.save.cash, this.save.cars, this.save.selected));
    this.hud.setCash(this.save.cash);
    this.sound.buy();
  }

  private get canSwap(): boolean {
    return this.save.rerollDay !== today();
  }

  /** One free mission swap a day. */
  private swapMission(index: number): void {
    if (!this.canSwap || !this.save.missions[index]) return;
    const others = this.save.missions.filter((_, i) => i !== index);
    this.save.missions[index] = drawMission(others, this.save.missionsDone);
    this.save.rerollDay = today();
    writeSave(this.portal.storage, this.save);
    this.hud.replaceMission(index, viewMission(this.save.missions[index]));
    this.sound.click();
  }

  private useSelectedCar(): void {
    const car = carById(this.save.selected);
    this.player.setCar(car, carStats(car, this.save.cars[car.id]));
  }

  private openGarage(carId?: string): void {
    if (this.adBusy) return;
    if (this.state === "crashed" && this.crashTimer < CRASH_OVERLAY_DELAY) return;
    if (this.state !== "ready" && this.state !== "crashed") return;
    this.reset();
    this.state = "garage";
    this.hud.hideAll();
    this.traffic.group.visible = false;
    this.police.group.visible = false;
    this.showroom.intensity = 28;
    this.garage.show(carId);
  }

  private closeGarage(): void {
    this.camera.clearViewOffset();
    this.showroom.intensity = 0;
    this.useSelectedCar();
    this.reset();
    this.traffic.group.visible = true;
    this.police.group.visible = true;
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
    if (!this.manualTime && !this.adBusy) this.step(dt);
    this.composer.render();
  }

  /**
   * Advance by one frame's dt in physics steps of at most 1/120 s, so the
   * game plays the same on 30, 60 and 144 Hz screens.
   */
  private step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt * MAX_STEP_HZ - 1e-6));
    for (let i = 0; i < n; i++) this.simulate(dt / n);
  }

  private simulate(dt: number): void {
    const input = this.input.read(dt);
    let dz = 0;

    if (this.state === "running" || this.state === "crashed") {
      this.player.update(dt, input);
      dz = this.player.speed * dt;
      this.road.update(dz);
      const p = this.player;
      const running = this.state === "running";
      this.traffic.walls = this.hazards.walls();
      this.traffic.update(dt, p.speed, this.stats.distanceKm);
      const chased = this.police.activeCount > 0;
      const hz = this.hazards.update(dt, p.speed, p.x, p.halfLength, this.level, chased, running);
      const ev = this.police.update(
        dt,
        { x: p.x, speed: p.speed, halfWidth: p.halfWidth, halfLength: p.halfLength, toughness: p.stats.toughness },
        this.level,
        [...this.traffic.obstacles(), ...this.hazards.obstacles()],
        running,
      );
      for (const w of ev.wrecks) this.debris.burst(w.x, w.z, w.speed, 4, 0.8);
      if (running) {
        this.policeEvents(ev);
        for (let i = 0; i < hz.roadblocksPassed; i++) {
          this.chain(HAZARDS.roadblock.combo);
          this.hud.popup(`ROADBLOCK RUN +${this.scoring.award("roadblock", HAZARDS.roadblock.bonus)}`, "escape");
          this.sound.roadblock();
          this.stats.roadblocks++;
        }
      }
      const heliWanted = running && chased && this.level >= HAZARDS.heli.minLevel;
      if (this.heli.update(dt, heliWanted, p.x) === "arrived") this.hud.popup("AIR SUPPORT ON YOU", "hazard");
      if (p.tiresBlown && !p.crashed && Math.random() < 0.5) this.debris.spark(p.x, 0.15, p.halfLength - 0.6, 2, p.speed);
      this.debris.update(dt, p.speed);
    }

    if (this.state === "running") {
      this.updateRun(dt);
    } else if (this.state === "crashed") {
      const before = this.crashTimer;
      this.crashTimer += dt;
      if (before < CRASH_OVERLAY_DELAY && this.crashTimer >= CRASH_OVERLAY_DELAY) {
        this.finishRun();
      }
    }

    if (this.state === "running" || this.state === "crashed") {
      this.hud.update(this.stats, this.player.speedKmh, this.highSpeedStreak);
      if (this.state === "running") {
        this.hud.updateChase({
          heat: this.heat,
          level: this.level,
          bust: this.police.bust,
          nearestCop: this.police.nearest,
          combo: this.scoring.combo,
          comboLeft: this.scoring.comboLeft,
          multiplier: this.scoring.multiplier,
          evade: this.pursuit ? this.evade : 0,
        });
        const warning = this.hazards.warning();
        if (warning && !this.hazardWarned) this.sound.warning();
        this.hazardWarned = warning !== null;
        this.hud.updateHazards(warning, this.player.tiresBlown, this.heli.watching);
      }
    }
    const nearCop = this.police.nearest;
    this.sound.update({
      speedKmh: this.state === "running" || this.state === "crashed" ? this.player.speedKmh : 0,
      throttle: this.state === "running" ? Math.max(input.throttle, input.brake > 0 ? 0 : 0.3) : 0,
      driving: this.state === "running",
      siren: this.state === "running" && nearCop !== null ? Math.max(0, 1 - Math.max(0, nearCop) / 150) : 0,
      heli: this.state === "running" && this.heli.watching ? 1 : 0,
    });
    const speedT = this.speedT();
    this.speedLines.update(speedT, dz, this.player.x);
    this.updateCamera(dt, speedT);
  }

  /** Wanted level 1..5 from heat. */
  private get level(): number {
    return Math.min(5, 1 + Math.floor(this.heat / HEAT.perLevel));
  }

  private policeEvents(ev: { takedowns: number; lost: number; bumpSide: number }): void {
    for (let i = 0; i < ev.takedowns; i++) {
      this.stats.takedowns++;
      this.heat += HEAT.takedown;
      this.chain(SCORE.takedownCombo);
      this.hud.popup(`TAKEDOWN +${this.scoring.award("takedown", SCORE.takedown)}`, "takedown");
      this.sound.takedown();
    }
    for (let i = 0; i < ev.lost; i++) {
      this.stats.copsLost++;
      this.hud.popup(`COP LOST +${this.scoring.award("copLost", SCORE.copLost)}`, "lost");
    }
    if (ev.bumpSide) {
      this.player.bump(ev.bumpSide);
      this.sound.bump();
      this.debris.spark(this.player.x - ev.bumpSide * this.player.halfWidth, 0.6, 0, 20, this.player.speed);
      this.shake = Math.max(this.shake, 0.25);
    }
  }

  private chain(steps: number): void {
    if (this.scoring.chain(steps)) {
      this.hud.popup(`MULTIPLIER x${this.scoring.multiplier}`, "multiplier");
      this.sound.multiplier(this.scoring.multiplier);
    }
  }

  /** Stay clear of the cops long enough and the wanted level drops a star. */
  private updateEscape(dt: number): void {
    const near = this.police.nearest;
    const close = near !== null && near < ESCAPE.clearDistance;
    if (close) this.pursuit = true;
    if (!this.pursuit) return;

    if (close) {
      this.evade = Math.max(0, this.evade - dt / ESCAPE.drainSeconds);
      return;
    }
    const rate = this.heli.watching ? HAZARDS.heli.evadeRate : 1;
    this.evade += (rate * dt) / (ESCAPE.baseSeconds + ESCAPE.perLevelSeconds * this.level);
    if (this.evade < 1) return;

    const from = this.level;
    const bonus = this.scoring.award("escape", ESCAPE.bonusPerLevel * from);
    this.heat = Math.max(0, (from - 2) * HEAT.perLevel); // start of the level below
    this.stats.escapes++;
    this.police.standDown(ESCAPE.cooldown);
    this.hazards.clearAhead();
    this.sound.escape();
    this.pursuit = false;
    this.evade = 0;
    const label = from > 1 ? `ESCAPED ${"★".repeat(from - 1)}` : "CLEAN GETAWAY";
    this.hud.popup(`${label} +${bonus}`, "escape");
  }

  /** Twice a second: a popup the moment a mission's target is reached (the cash is paid at the end of the run). */
  private updateMissions(dt: number): void {
    this.missionCheck -= dt;
    if (this.missionCheck > 0) return;
    this.missionCheck = 0.5;
    liveViews(this.save.missions, this.stats).forEach((v, i) => {
      if (!v.done || this.missionDoneShown.has(i)) return;
      this.missionDoneShown.add(i);
      this.hud.popup(`MISSION DONE +${v.reward}`, "escape");
      this.sound.escape();
    });
  }

  /** The hint stays 6 s of driving, or until a key/tap once it has been up 1.5 s (so it is never skipped unseen). */
  private updateHint(dt: number): void {
    if (this.hintTime < 0) return;
    this.hintTime += dt;
    if (this.hintTime > 6 || (this.hintSkip && this.hintTime > 1.5)) {
      this.hintTime = -1;
      this.hud.hideHint();
    }
  }

  /** Bank the run, maybe show a midgame ad (at the death transition), then the results. */
  private finishRun(): void {
    const score = Math.floor(this.stats.score);
    const previousBest = this.save.best;
    const isBest = score > previousBest;
    if (isBest) this.save.best = score;
    const earned = cashForScore(score);
    this.save.cash += earned;
    // missions: show them as they stood at the end of this run, then fold the run in
    const missionViews = liveViews(this.save.missions, this.stats);
    const missions = applyRun(this.save.missions, this.stats, this.save.missionsDone);
    this.save.missionsDone += missions.completed.length;
    this.save.cash += missions.cash;
    writeSave(this.portal.storage, this.save);
    this.lastEarned = earned;
    this.doubled = false;
    if (isBest && previousBest > 0 && !this.celebrated) {
      this.celebrated = true; // once a session keeps it special
      this.portal.happytime();
    }
    const show = () => {
      this.hud.showCrash(this.stats, isBest, earned, missions.cash, this.save.cash, this.portal.hasRewarded && earned > 0);
      this.hud.showMissions(missionViews, this.canSwap);
      this.showProgressCards();
    };
    const adDue = this.playSeconds >= ADS.firstAfterSeconds && this.playSeconds - this.playAtLastAd >= ADS.everySeconds;
    if (!adDue) {
      show();
      return;
    }
    void this.runAd("midgame").then((r) => {
      if (r === "finished") this.playAtLastAd = this.playSeconds;
      show();
    });
  }

  private async runAd(kind: "midgame" | "rewarded"): Promise<AdResult> {
    this.adBusy = true;
    this.hud.setAdBusy(true);
    const hooks = { started: () => this.sound.setAdPlaying(true) };
    const result = await (kind === "midgame" ? this.portal.midgameAd(hooks) : this.portal.rewardedAd(hooks));
    this.sound.setAdPlaying(false);
    this.hud.setAdBusy(false);
    this.adBusy = false;
    this.clock.getDelta(); // don't simulate the time the ad took
    return result;
  }

  /** Rewarded ad on the results screen: pays the run's cash again, only when the ad completes. */
  private async doubleCash(): Promise<void> {
    if (this.adBusy || this.doubled || this.state !== "crashed" || this.lastEarned <= 0) return;
    const result = await this.runAd("rewarded");
    if (result !== "finished") {
      this.hud.rewardUnavailable();
      return;
    }
    this.doubled = true;
    this.save.cash += this.lastEarned;
    writeSave(this.portal.storage, this.save);
    this.hud.cashDoubled(this.lastEarned * 2, this.save.cash);
    this.hud.showGoal(nextGoal(this.save.cash, this.save.cars, this.save.selected));
    this.sound.buy();
  }

  private end(reason: RunStats["end"]): void {
    if (this.hintTime >= 0) {
      this.hintTime = -1;
      this.hud.hideHint();
    }
    this.portal.gameplayStop();
    this.input.release();
    this.stats.end = reason;
    this.state = "crashed";
    document.body.classList.remove("driving");
    this.highSpeedStreak = 0;
    this.scoring.breakCombo();
    this.syncScore();
  }

  private syncScore(): void {
    this.stats.score = this.scoring.total;
    this.stats.points = this.scoring.breakdown();
    this.stats.bestCombo = this.scoring.bestCombo;
    this.stats.bestMultiplier = this.scoring.bestMultiplier;
  }

  private speedT(): number {
    const min = PLAYER.minSpeedKmh * KMH;
    const max = PLAYER.fxMaxSpeedKmh * KMH;
    return THREE.MathUtils.clamp((this.player.speed - min) / (max - min), 0, 1);
  }

  private updateRun(dt: number): void {
    const p = this.player;
    const kmh = p.speedKmh;
    const metres = p.speed * dt;
    this.stats.distanceKm += metres / 1000;
    this.playSeconds += dt;
    this.updateHint(dt);
    this.updateMissions(dt);
    this.stats.topSpeedKmh = Math.max(this.stats.topSpeedKmh, kmh);

    // driving points: distance weighted by speed, plus a bonus above HIGH_SPEED_KMH
    this.scoring.update(dt);
    let driving = metres * SCORE.perMetre * (kmh / 100);
    if (kmh >= HIGH_SPEED_KMH) {
      this.highSpeedStreak += dt;
      this.stats.highSpeedSeconds += dt;
      driving += dt * SCORE.highSpeedPerSecond;
    } else {
      this.highSpeedStreak = 0;
    }
    this.scoring.award("driving", driving);

    // heat builds on its own and faster when driving flat out
    this.heat += dt * (HEAT.perSecond + (kmh >= HEAT.fastKmh ? HEAT.perSecondFast : 0));

    // near misses build the combo, and with it the multiplier
    const misses = this.traffic.nearMisses(p.x, p.halfWidth);
    for (let i = 0; i < misses; i++) {
      this.stats.nearMisses++;
      this.heat += HEAT.nearMiss;
      this.chain(1);
      this.hud.popup(`NEAR MISS +${this.scoring.award("nearMiss", SCORE.nearMiss)}`, "near");
      this.sound.nearMiss();
    }
    this.updateEscape(dt);
    this.stats.maxLevel = Math.max(this.stats.maxLevel, this.level);
    this.syncScore();

    const box = { x: p.x, z: 0, halfWidth: p.halfWidth * 0.95, halfLength: p.halfLength * 0.95 };
    const hit = this.hazards.collide(box);
    if (hit.spikes) {
      const s = HAZARDS.spikes;
      p.blowTires(s.capSeconds, s.capKmh, s.speedKept);
      this.heat += s.heat;
      this.shake = Math.max(this.shake, 0.35);
      this.debris.spark(p.x, 0.2, 0, 40, p.speed);
      this.sound.spikes();
      this.hud.popup("TYRES BLOWN", "hazard");
    }
    const side = this.traffic.collide(box) || hit.roadblock;
    if (side !== 0) {
      this.debris.burst(p.x, -p.halfLength, p.speed, 7, 1.2);
      this.sound.crash();
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

    if (this.state === "garage") {
      // slow turntable orbit around the parked car
      this.garageAngle += dt * 0.35;
      const r = cam.aspect < 1 ? 13 : 8.5; // portrait needs more distance to fit the car
      cam.position.set(Math.sin(this.garageAngle + 0.6) * r, 3.2, Math.cos(this.garageAngle + 0.6) * r);
      cam.fov = (cam.userData.baseFov as number) ?? 62;
      // short landscape screens put the panel on the right: shift the car into the left half
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (h <= 520 && w > h) cam.setViewOffset(w, h, w * 0.22, 0, w, h);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
      cam.lookAt(0, -0.6, 0);
      this.skyline.follow(cam.position.x);
      this.moon.position.set(-20, 40, 25);
      this.moon.target.position.set(0, 0, -15);
      return;
    }

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
