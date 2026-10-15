import {
  CARS, MAX_UPGRADE, STAT_CEILING, UPGRADE_KINDS, UPGRADE_LABEL, carStats, upgradePrice,
  type CarDef, type CarStats, type UpgradeKind,
} from "./cars";
import { noUpgrades, type SaveData } from "./save";

// Garage overlay: browse cars, buy them, buy upgrades. The game shows the
// browsed car in 3D behind the panel (host.preview) and persists (host.commit).

export interface GarageHost {
  readonly save: SaveData;
  preview(car: CarDef, stats: CarStats): void;
  commit(): void;
  drive(): void;
  back(): void;
}

const $ = (id: string) => document.getElementById(id)!;
export const money = (n: number) => `$${n.toLocaleString("en-US")}`;

const STAT_ROWS: { key: keyof CarStats; label: string; upgrade?: UpgradeKind; format: (s: CarStats) => string }[] = [
  { key: "topSpeedKmh", label: "Top speed", upgrade: "engine", format: (s) => `${s.topSpeedKmh} km/h` },
  { key: "accel", label: "Acceleration", upgrade: "turbo", format: (s) => s.accel.toFixed(1) },
  { key: "steerSpeed", label: "Handling", upgrade: "handling", format: (s) => s.steerSpeed.toFixed(1) },
  { key: "toughness", label: "Toughness", format: (s) => `x${s.toughness.toFixed(1)}` },
];

export class Garage {
  private readonly overlay = $("overlay-garage");
  private index = 0;
  private open = false;

  constructor(private readonly host: GarageHost) {
    $("garage-prev").addEventListener("click", () => this.step(-1));
    $("garage-next").addEventListener("click", () => this.step(1));
    $("garage-back").addEventListener("click", () => this.close("back"));
    $("garage-action").addEventListener("click", () => this.action());
    for (const k of UPGRADE_KINDS) {
      $(`up-${k}`).addEventListener("click", () => this.upgrade(k));
    }
    window.addEventListener("keydown", (e) => {
      if (!this.open || e.repeat) return;
      if (e.code === "ArrowLeft" || e.code === "KeyA") this.step(-1);
      else if (e.code === "ArrowRight" || e.code === "KeyD") this.step(1);
      else if (e.code === "Escape") this.close("back");
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.index = Math.max(0, CARS.findIndex((c) => c.id === this.host.save.selected));
    this.overlay.classList.remove("hidden");
    this.render();
  }

  /** Space / Enter: drive the browsed car if owned (never buys by accident). */
  driveIfOwned(): void {
    if (this.open && this.host.save.cars[CARS[this.index].id]) this.close("drive");
  }

  /** The main button: drive an owned car, or buy this one. */
  private action(): void {
    const car = CARS[this.index];
    const save = this.host.save;
    if (save.cars[car.id]) {
      this.close("drive");
      return;
    }
    if (save.cash < car.price) return;
    save.cash -= car.price;
    save.cars[car.id] = noUpgrades();
    save.selected = car.id;
    this.host.commit();
    this.render();
    this.flash("garage-action");
  }

  private close(how: "drive" | "back"): void {
    this.open = false;
    this.overlay.classList.add("hidden");
    if (how === "drive") this.host.drive();
    else this.host.back();
  }

  private step(d: number): void {
    this.index = (this.index + d + CARS.length) % CARS.length;
    const car = CARS[this.index];
    if (this.host.save.cars[car.id]) {
      this.host.save.selected = car.id;
      this.host.commit();
    }
    this.render();
  }

  private upgrade(kind: UpgradeKind): void {
    const car = CARS[this.index];
    const save = this.host.save;
    const up = save.cars[car.id];
    if (!up) return;
    const price = upgradePrice(car, up[kind]);
    if (price === null || save.cash < price) return;
    save.cash -= price;
    up[kind]++;
    this.host.commit();
    this.render();
    this.flash(`up-${kind}`);
  }

  private flash(id: string): void {
    const el = $(id);
    el.classList.remove("bought");
    void el.offsetWidth; // restart the animation
    el.classList.add("bought");
  }

  private render(): void {
    const car = CARS[this.index];
    const save = this.host.save;
    const owned = save.cars[car.id];
    const stats = carStats(car, owned ?? noUpgrades());
    this.host.preview(car, stats);

    $("garage-cash").textContent = money(save.cash);
    $("garage-name").textContent = car.name;
    $("garage-blurb").textContent = car.blurb;
    $("garage-count").textContent = `${this.index + 1} / ${CARS.length}`;

    for (const row of STAT_ROWS) {
      const el = $(`stat-${row.key}`);
      const fill = el.querySelector<HTMLElement>(".fill")!;
      fill.style.width = `${Math.min(100, (stats[row.key] / STAT_CEILING[row.key]) * 100)}%`;
      el.querySelector(".num")!.textContent = row.format(stats);
      if (!row.upgrade) continue;
      const level = owned?.[row.upgrade] ?? 0;
      el.querySelector(".pips")!.innerHTML = Array.from({ length: MAX_UPGRADE }, (_, i) =>
        `<i class="${i < level ? "on" : ""}"></i>`).join("");
      const btn = $(`up-${row.upgrade}`) as HTMLButtonElement;
      const price = upgradePrice(car, level);
      btn.classList.toggle("hidden", !owned);
      btn.disabled = price === null || save.cash < price;
      btn.textContent = price === null ? "MAX" : `+ ${money(price)}`;
      btn.title = `Upgrade ${UPGRADE_LABEL[row.upgrade].toLowerCase()}`;
    }

    const action = $("garage-action") as HTMLButtonElement;
    const status = $("garage-status");
    if (owned) {
      action.textContent = "DRIVE";
      action.disabled = false;
      status.textContent = "OWNED";
      status.className = "owned";
    } else {
      action.textContent = `BUY ${money(car.price)}`;
      action.disabled = save.cash < car.price;
      status.textContent = save.cash < car.price ? `Need ${money(car.price - save.cash)} more` : "For sale";
      status.className = "";
    }
  }
}
