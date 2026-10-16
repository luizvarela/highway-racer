import { CARS, MAX_UPGRADE, UPGRADE_KINDS, type Upgrades } from "./cars";
import { MISSION_SLOTS, TEMPLATES, initialMissions, type Daily, type Mission } from "./missions";

// Player progress. Kept in localStorage for now; this is the one place to
// swap in a portal's cloud save (e.g. the CrazyGames SDK data module) later.

// keys keep the project's original name: renaming them would drop players' progress
export const SAVE_KEY = "highway-racer.save";
const KEY = SAVE_KEY;
const LEGACY_BEST_KEY = "highway-racer.best";

export interface SaveData {
  v: 1;
  best: number;
  cash: number;
  selected: string;
  /** owned cars and their upgrade levels */
  cars: Record<string, Upgrades>;
  muted: boolean;
  missions: Mission[];
  missionsDone: number; // lifetime completions; sets the tier of new missions
  rerollDay: string; // YYYY-MM-DD of the last free reroll
  daily: Daily;
}

export const noUpgrades = (): Upgrades => ({ engine: 0, turbo: 0, handling: 0 });

function fresh(): SaveData {
  return {
    v: 1, best: 0, cash: 0, selected: CARS[0].id, cars: { [CARS[0].id]: noUpgrades() }, muted: false,
    missions: initialMissions(), missionsDone: 0, rerollDay: "", daily: { lastClaim: "", streak: 0 },
  };
}

export type SaveStore = Pick<Storage, "getItem" | "setItem">;

function localRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load and sanitise: a corrupt or hand-edited save must never break the game.
 * Reads the portal's store first (cloud save), then this browser's
 * localStorage, so progress made before a portal build carries over.
 */
export function loadSave(store: SaveStore): SaveData {
  const data = fresh();
  try {
    let text: string | null = null;
    try {
      text = store.getItem(KEY);
    } catch {
      /* store unavailable */
    }
    const raw = JSON.parse(text ?? localRead(KEY) ?? "null") as Partial<SaveData> | null;
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
      data.muted = raw.muted === true;
      // missions: keep only well-formed ones with a known template, top up to the slot count
      const ids = new Set(TEMPLATES.map((t) => t.id));
      const missions = (Array.isArray(raw.missions) ? raw.missions : [])
        .filter((m): m is Mission => !!m && typeof m === "object" && ids.has(String(m.id)))
        .map((m) => ({ id: String(m.id), tier: Math.max(0, Math.floor(Number(m.tier) || 0)), progress: Math.max(0, Number(m.progress) || 0) }))
        .slice(0, MISSION_SLOTS);
      data.missionsDone = Math.max(0, Math.floor(Number(raw.missionsDone) || 0));
      if (missions.length) data.missions = missions;
      data.rerollDay = typeof raw.rerollDay === "string" ? raw.rerollDay : "";
      if (raw.daily && typeof raw.daily === "object") {
        data.daily = { lastClaim: typeof raw.daily.lastClaim === "string" ? raw.daily.lastClaim : "", streak: Math.max(0, Math.floor(Number(raw.daily.streak) || 0)) };
      }
      if (typeof raw.selected === "string" && data.cars[raw.selected]) data.selected = raw.selected;
    } else {
      data.best = Math.max(0, Math.floor(Number(localRead(LEGACY_BEST_KEY)) || 0));
    }
  } catch {
    /* unreadable save: start fresh */
  }
  return data;
}

export function writeSave(store: SaveStore, data: SaveData): void {
  try {
    store.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("progress not saved", e);
  }
}
