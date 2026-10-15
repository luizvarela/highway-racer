import type { VehicleKind } from "./vehicles";

// The garage: fictional cars (Kenney CC0 bodies for now) and their upgrades.
// Names must stay fictional: no real makes or models.

export type UpgradeKind = "engine" | "turbo" | "handling";
export const UPGRADE_KINDS: UpgradeKind[] = ["engine", "turbo", "handling"];
export const MAX_UPGRADE = 5;
export type Upgrades = Record<UpgradeKind, number>;

export interface CarDef {
  id: string;
  name: string;
  blurb: string;
  model: VehicleKind;
  price: number;
  glow: number; // underglow colour
  topSpeedKmh: number;
  accel: number; // m/s² at standstill
  steerSpeed: number; // max lateral m/s
  toughness: number; // bust meter takes this many times longer to fill
  upgradeCost: number; // cost of the first upgrade level; later levels scale up
}

export const CARS: CarDef[] = [
  {
    id: "comet", name: "Comet", blurb: "A tidy street sedan. Every getaway starts somewhere.",
    model: "sedan-sports", price: 0, glow: 0x00e5ff,
    topSpeedKmh: 205, accel: 6.5, steerSpeed: 10, toughness: 1, upgradeCost: 250,
  },
  {
    id: "viper", name: "Viper", blurb: "Light hatch that darts between lanes.",
    model: "hatchback-sports", price: 3000, glow: 0xff2bd6,
    topSpeedKmh: 215, accel: 7.5, steerSpeed: 12, toughness: 0.9, upgradeCost: 400,
  },
  {
    id: "bruiser", name: "Bruiser", blurb: "Heavy luxury SUV. Cops struggle to box it in.",
    model: "suv-luxury", price: 6500, glow: 0xff8a1a,
    topSpeedKmh: 220, accel: 7, steerSpeed: 9.5, toughness: 1.6, upgradeCost: 600,
  },
  {
    id: "phantom", name: "Phantom", blurb: "Prototype racer. Outruns anything with a siren.",
    model: "race-future", price: 15000, glow: 0x9dff3a,
    topSpeedKmh: 240, accel: 8.5, steerSpeed: 12.5, toughness: 1, upgradeCost: 900,
  },
];

/** What one upgrade level adds. */
export const UPGRADE_STEP: Record<UpgradeKind, number> = {
  engine: 10, // km/h top speed
  turbo: 0.6, // m/s² acceleration
  handling: 0.6, // m/s steering
};

export const UPGRADE_LABEL: Record<UpgradeKind, string> = {
  engine: "Engine",
  turbo: "Turbo",
  handling: "Handling",
};

const LEVEL_COST_SCALE = [1, 2, 3.5, 5.5, 8];

/** Price of the next level, or null when maxed. */
export function upgradePrice(car: CarDef, level: number): number | null {
  return level >= MAX_UPGRADE ? null : Math.round(car.upgradeCost * LEVEL_COST_SCALE[level]);
}

export interface CarStats {
  topSpeedKmh: number;
  accel: number;
  steerSpeed: number;
  toughness: number;
}

export function carStats(car: CarDef, up: Upgrades): CarStats {
  return {
    topSpeedKmh: car.topSpeedKmh + up.engine * UPGRADE_STEP.engine,
    accel: car.accel + up.turbo * UPGRADE_STEP.turbo,
    steerSpeed: car.steerSpeed + up.handling * UPGRADE_STEP.handling,
    toughness: car.toughness,
  };
}

/** Fully upgraded stats of the best car: the top of every stat bar. */
export const STAT_CEILING: CarStats = {
  topSpeedKmh: Math.max(...CARS.map((c) => c.topSpeedKmh)) + MAX_UPGRADE * UPGRADE_STEP.engine,
  accel: Math.max(...CARS.map((c) => c.accel)) + MAX_UPGRADE * UPGRADE_STEP.turbo,
  steerSpeed: Math.max(...CARS.map((c) => c.steerSpeed)) + MAX_UPGRADE * UPGRADE_STEP.handling,
  toughness: Math.max(...CARS.map((c) => c.toughness)),
};

export const carById = (id: string): CarDef => CARS.find((c) => c.id === id) ?? CARS[0];

/** Cash earned for a run: $1 per 5 points. */
export const cashForScore = (score: number): number => Math.floor(score / 5);
