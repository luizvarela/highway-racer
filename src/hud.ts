// Thin wrapper over the DOM HUD and overlays declared in index.html.

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface RunStats {
  score: number;
  distanceKm: number;
  topSpeedKmh: number;
  highSpeedSeconds: number;
}

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

  showCrash(stats: RunStats, isBest: boolean): void {
    $("crash-score").textContent = String(Math.floor(stats.score));
    $("crash-distance").textContent = `${stats.distanceKm.toFixed(2)} km`;
    $("crash-top").textContent = `${Math.round(stats.topSpeedKmh)} km/h`;
    $("crash-highspeed").textContent = `${stats.highSpeedSeconds.toFixed(1)} s`;
    $("crash-best").classList.toggle("hidden", !isBest);
    this.crashOverlay.classList.remove("hidden");
  }
}
