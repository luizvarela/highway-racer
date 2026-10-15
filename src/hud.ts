import { HEAT } from "./config";
import { money } from "./garage";
import type { HazardWarning } from "./hazards";
import { POINT_SOURCES, type PointSource } from "./scoring";

// Thin wrapper over the DOM HUD and overlays declared in index.html.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface RunStats {
  score: number;
  distanceKm: number;
  topSpeedKmh: number;
  highSpeedSeconds: number;
  nearMisses: number;
  bestCombo: number;
  bestMultiplier: number;
  takedowns: number;
  copsLost: number;
  escapes: number;
  roadblocks: number;
  maxLevel: number;
  points: Record<PointSource, number>;
  end: "crashed" | "busted";
}

export interface ChaseView {
  heat: number;
  level: number;
  bust: number; // 0..1
  nearestCop: number | null; // metres behind (negative = alongside/ahead)
  combo: number;
  comboLeft: number; // 0..1 of the combo window left
  multiplier: number;
  evade: number; // 0..1 escape progress
}

export type PopupKind = "near" | "takedown" | "lost" | "multiplier" | "escape" | "hazard";

export class Hud {
  private readonly hud = $("hud");
  private readonly score = $("hud-score");
  private readonly best = $("hud-best");
  private readonly speed = $("hud-speed");
  private readonly distance = $("hud-distance");
  private readonly highSpeed = $("hud-highspeed");
  private readonly highSpeedTime = $("hud-highspeed-time");
  private readonly startOverlay = $("overlay-start");
  private readonly crashOverlay = $("overlay-crash");
  private readonly stars = [...document.querySelectorAll<HTMLElement>("#hud-heat .star")];
  private readonly heatFill = $("hud-heat-fill");
  private readonly bust = $("hud-bust");
  private readonly bustFill = $("hud-bust-fill");
  private readonly warn = $("hud-police");
  private readonly warnDist = $("hud-police-dist");
  private readonly siren = $("siren");
  private readonly popups = $("popups");
  private readonly mult = $("hud-mult");
  private readonly multValue = $("hud-mult-value");
  private readonly comboCount = $("hud-combo-count");
  private readonly comboFill = $("hud-combo-fill");
  private readonly evade = $("hud-evade");
  private readonly evadeFill = $("hud-evade-fill");
  private readonly hazard = $("hud-hazard");
  private readonly hazardText = $("hud-hazard-text");
  private readonly hazardDist = $("hud-hazard-dist");
  private readonly hazardLanes = [...document.querySelectorAll<HTMLElement>("#hud-hazard .hazard-lanes i")];
  private readonly flat = $("hud-flat");
  private readonly heli = $("hud-heli");
  private readonly mute = $("btn-mute");

  constructor(onStart: () => void, onGarage: () => void, onMute: () => void, onDouble: () => void) {
    $("btn-double").addEventListener("click", onDouble);
    this.mute.addEventListener("click", onMute);
    $("btn-start").addEventListener("click", onStart);
    $("btn-restart").addEventListener("click", onStart);
    $("btn-garage").addEventListener("click", onGarage);
    $("btn-garage-2").addEventListener("click", onGarage);
  }

  showStart(carName: string, cash: number): void {
    $("start-car").textContent = carName;
    $("start-cash").textContent = money(cash);
    this.startOverlay.classList.remove("hidden");
    this.crashOverlay.classList.add("hidden");
    this.hud.classList.add("hidden");
  }

  /** Everything off: the garage draws its own overlay. */
  hideAll(): void {
    this.clearChase();
    this.startOverlay.classList.add("hidden");
    this.crashOverlay.classList.add("hidden");
    this.hud.classList.add("hidden");
  }

  showRunning(best: number): void {
    this.clearChase();
    this.startOverlay.classList.add("hidden");
    this.crashOverlay.classList.add("hidden");
    this.hud.classList.remove("hidden");
    this.best.textContent = String(best);
  }

  update(stats: RunStats, speedKmh: number, highSpeedStreak: number): void {
    this.score.textContent = String(Math.floor(stats.score));
    this.speed.textContent = String(Math.round(speedKmh));
    this.distance.textContent = stats.distanceKm.toFixed(2);
    const on = highSpeedStreak > 0;
    this.highSpeed.classList.toggle("hidden", !on);
    if (on) this.highSpeedTime.textContent = highSpeedStreak.toFixed(1);
  }

  updateChase(v: ChaseView): void {
    const { level, bust, nearestCop } = v;
    this.stars.forEach((s, i) => s.classList.toggle("on", i < level));
    this.heatFill.style.width = `${level >= 5 ? 100 : ((v.heat % HEAT.perLevel) / HEAT.perLevel) * 100}%`;

    this.bust.classList.toggle("hidden", bust <= 0);
    this.bustFill.style.width = `${bust * 100}%`;

    // warn about cops behind (the camera can't see them) and pulse the edges
    const close = nearestCop !== null && nearestCop > -10 && nearestCop < 120;
    this.warn.classList.toggle("hidden", !close);
    if (close) this.warnDist.textContent = nearestCop! <= 3 ? "ON YOU" : `${Math.round(nearestCop!)} m`;
    const proximity = close ? 1 - Math.max(0, nearestCop!) / 120 : 0;
    this.siren.style.opacity = String(Math.max(proximity * 0.85, bust));

    this.evade.classList.toggle("hidden", v.evade <= 0 || bust > 0);
    this.evadeFill.style.width = `${v.evade * 100}%`;

    this.mult.classList.toggle("hidden", v.combo <= 0);
    this.mult.dataset.level = String(v.multiplier);
    this.multValue.textContent = String(v.multiplier);
    this.comboCount.textContent = String(v.combo);
    this.comboFill.style.width = `${v.comboLeft * 100}%`;
  }

  /** Warning for the next roadblock / spike strip, with its lanes (red = blocked). */
  updateHazards(w: HazardWarning | null, flatTyres: boolean, heli: boolean): void {
    this.hazard.classList.toggle("hidden", !w);
    if (w) {
      this.hazard.dataset.kind = w.kind;
      this.hazardText.textContent = w.kind === "roadblock" ? "ROADBLOCK" : "SPIKES";
      this.hazardDist.textContent = `${Math.round(w.distance)} m`;
      this.hazardLanes.forEach((el, i) => el.classList.toggle("on", w.lanes[i]));
    }
    this.flat.classList.toggle("hidden", !flatTyres);
    this.heli.classList.toggle("hidden", !heli);
  }

  setMuted(muted: boolean): void {
    this.mute.textContent = muted ? "🔇" : "🔊";
  }

  popup(text: string, kind: PopupKind): void {
    const el = document.createElement("div");
    el.className = `popup ${kind}`;
    el.textContent = text;
    this.popups.prepend(el);
    while (this.popups.children.length > 4) this.popups.lastElementChild!.remove();
    el.addEventListener("animationend", () => el.remove());
  }

  private clearChase(): void {
    this.popups.replaceChildren();
    this.bust.classList.add("hidden");
    this.warn.classList.add("hidden");
    this.mult.classList.add("hidden");
    this.evade.classList.add("hidden");
    this.hazard.classList.add("hidden");
    this.flat.classList.add("hidden");
    this.heli.classList.add("hidden");
    this.siren.style.opacity = "0";
  }

  /** Block all input while an ad loads or plays. */
  setAdBusy(on: boolean): void {
    $("ad-block").classList.toggle("hidden", !on);
  }

  cashDoubled(earned: number, cash: number): void {
    $("crash-cash").textContent = money(earned);
    $("crash-total").textContent = money(cash);
    $("btn-double").classList.add("hidden");
    $("crash-doubled").classList.remove("hidden");
  }

  rewardUnavailable(): void {
    const b = $("btn-double") as HTMLButtonElement;
    b.disabled = true;
    b.textContent = "NO AD RIGHT NOW";
  }

  showCrash(stats: RunStats, isBest: boolean, earned: number, cash: number, canDouble: boolean): void {
    const dbl = $("btn-double") as HTMLButtonElement;
    dbl.classList.toggle("hidden", !canDouble);
    dbl.disabled = false;
    dbl.innerHTML = '<span class="ad-icon">▶</span> 2× CASH';
    $("crash-doubled").classList.add("hidden");
    this.clearChase();
    $("crash-title").textContent = stats.end === "busted" ? "BUSTED" : "CRASHED";
    $("crash-score").textContent = Math.floor(stats.score).toLocaleString("en-US");
    for (const src of POINT_SOURCES) $(`pts-${src}`).textContent = stats.points[src].toLocaleString("en-US");
    $("crash-distance").textContent = `${stats.distanceKm.toFixed(2)} km`;
    $("crash-top").textContent = `${Math.round(stats.topSpeedKmh)} km/h`;
    $("crash-nearmiss").textContent = `${stats.nearMisses} (best combo ${stats.bestCombo})`;
    $("crash-mult").textContent = `x${stats.bestMultiplier}`;
    $("crash-police").textContent = `${stats.takedowns} · ${stats.escapes}`;
    $("crash-roadblocks").textContent = String(stats.roadblocks);
    $("crash-heat").textContent = "★".repeat(stats.maxLevel);
    $("crash-best").classList.toggle("hidden", !isBest);
    $("crash-cash").textContent = money(earned);
    $("crash-total").textContent = money(cash);
    this.crashOverlay.classList.remove("hidden");
  }
}
