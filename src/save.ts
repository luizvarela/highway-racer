import { CARS, MAX_UPGRADE, UPGRADE_KINDS, type Upgrades } from "./cars";

// Player progress. Kept in localStorage for now; this is the one place to
// swap in a portal's cloud save (e.g. the CrazyGames SDK data module) later.

const KEY = "highway-racer.save";
const LEGACY_BEST_KEY = "highway-racer.best";

export interface SaveData {
  v: 1;
  best: number;
  cash: number;
  selected: string;
  /** owned cars and their upgrade levels */
  cars: Record<string, Upgrades>;
}

export const noUpgrades = (): Upgrades => ({ engine: 0, turbo: 0, handling: 0 });

function fresh(): SaveData {
  return { v: 1, best: 0, cash: 0, selected: CARS[0].id, cars: { [CARS[0].id]: noUpgrades() } };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Load and sanitise: a corrupt or hand-edited save must never break the game. */
export function loadSave(): SaveData {
  const data = fresh();
  try {
    const raw = JSON.parse(read(KEY) ?? "null") as Partial<SaveData> | null;
    if (raw && typeof raw === "object") {
      data.best = Math.max(0, Math.floor(Number(raw.best) || 0));
      data.cash = Math.max(0, Math.floor(Number(raw.cash) || 0));
      for (const car of CARS) {
        const up = raw.cars?.[car.id];
        if (!up) continue;
        const clean = noUpgrades();
        for (const k of UPGRADE_KINDS) clean[k] = Math.min(MAX_UPGRADE, Math.max(0, Math.floor(Number(up[k]) || 0)));
        data.cars[car.id] = clean;
      }
      if (typeof raw.selected === "string" && data.cars[raw.selected]) data.selected = raw.selected;
    } else {
      data.best = Math.max(0, Math.floor(Number(read(LEGACY_BEST_KEY)) || 0));
    }
  } catch {
    /* unreadable save: start fresh */
  }
  return data;
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress just isn't persisted */
  }
}
