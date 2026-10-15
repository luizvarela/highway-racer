// Thin wrapper over the DOM HUD and overlays declared in index.html.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface RunStats {
  score: number;
  distanceKm: number;
  topSpeedKmh: number;
  highSpeedSeconds: number;
  nearMisses: number;
  bestCombo: number;
  takedowns: number;
  copsLost: number;
  maxLevel: number;
  end: "crashed" | "busted";
}

export type PopupKind = "near" | "takedown" | "lost";

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
  private readonly combo = $("hud-combo");

  constructor(onStart: () => void) {
    $("btn-start").addEventListener("click", onStart);
    $("btn-restart").addEventListener("click", onStart);
  }

  showStart(): void {
    this.startOverlay.classList.remove("hidden");
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

  updateChase(heat: number, level: number, bust: number, nearestCop: number | null, combo: number, comboTimer: number): void {
    this.stars.forEach((s, i) => s.classList.toggle("on", i < level));
    this.heatFill.style.width = `${level >= 5 ? 100 : ((heat % 20) / 20) * 100}%`;

    this.bust.classList.toggle("hidden", bust <= 0);
    this.bustFill.style.width = `${bust * 100}%`;

    // warn about cops behind (the camera can't see them) and pulse the edges
    const close = nearestCop !== null && nearestCop > -10 && nearestCop < 120;
    this.warn.classList.toggle("hidden", !close);
    if (close) this.warnDist.textContent = nearestCop! <= 3 ? "ON YOU" : `${Math.round(nearestCop!)} m`;
    const proximity = close ? 1 - Math.max(0, nearestCop!) / 120 : 0;
    this.siren.style.opacity = String(Math.max(proximity * 0.85, bust));

    this.combo.classList.toggle("hidden", combo < 2);
    if (combo >= 2) {
      this.combo.textContent = `COMBO x${combo}`;
      this.combo.style.opacity = String(Math.min(1, comboTimer / 1));
    }
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
    this.combo.classList.add("hidden");
    this.siren.style.opacity = "0";
  }

  showCrash(stats: RunStats, isBest: boolean): void {
    this.clearChase();
    $("crash-title").textContent = stats.end === "busted" ? "BUSTED" : "CRASHED";
    $("crash-nearmiss").textContent = `${stats.nearMisses} (best x${stats.bestCombo})`;
    $("crash-takedowns").textContent = String(stats.takedowns);
    $("crash-lost").textContent = String(stats.copsLost);
    $("crash-heat").textContent = "★".repeat(stats.maxLevel);
    $("crash-score").textContent = String(Math.floor(stats.score));
    $("crash-distance").textContent = `${stats.distanceKm.toFixed(2)} km`;
    $("crash-top").textContent = `${Math.round(stats.topSpeedKmh)} km/h`;
    $("crash-highspeed").textContent = `${stats.highSpeedSeconds.toFixed(1)} s`;
    $("crash-best").classList.toggle("hidden", !isBest);
    this.crashOverlay.classList.remove("hidden");
  }
}
