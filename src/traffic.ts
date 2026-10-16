import * as THREE from "three";
import { KMH, LANE_COUNT, SCORE, TRAFFIC, ease, laneCenter } from "./config";
import type { LaneWall } from "./hazards";
import { buildVehicle, spinWheels, type VehicleKind, type VehicleModel } from "./vehicles";

// Pooled traffic. Every vehicle keeps its lane, drives at its own cruise speed
// and slows behind a slower vehicle. Position is relative to the player.

interface TrafficCar {
  model: VehicleModel;
  active: boolean;
  lane: number;
  cruise: number; // m/s
  speed: number; // m/s
  passed: boolean; // already overtaken by the player (near-miss checked)
}

export const TRAFFIC_KINDS: { kind: VehicleKind; weight: number; speedKmh: [number, number] }[] = [
  { kind: "sedan", weight: 4, speedKmh: [70, 105] },
  { kind: "sedan-sports", weight: 2, speedKmh: [80, 115] },
  { kind: "hatchback-sports", weight: 3, speedKmh: [65, 100] },
  { kind: "suv", weight: 3, speedKmh: [65, 100] },
  { kind: "suv-luxury", weight: 2, speedKmh: [75, 110] },
  { kind: "taxi", weight: 2, speedKmh: [65, 95] },
  { kind: "van", weight: 2, speedKmh: [60, 85] },
  { kind: "delivery", weight: 1.5, speedKmh: [55, 80] },
  { kind: "hero-truck", weight: 1.2, speedKmh: [50, 75] },
  { kind: "hero-bus", weight: 0.7, speedKmh: [50, 72] },
  { kind: "truck-flat", weight: 1, speedKmh: [50, 75] },
  { kind: "garbage-truck", weight: 0.6, speedKmh: [45, 65] },
  { kind: "ambulance", weight: 0.4, speedKmh: [80, 110] },
  { kind: "firetruck", weight: 0.3, speedKmh: [60, 85] },
];

/** Highest speed that can still stop within `gap` metres (leaving TRAFFIC.stopGap). */
const brakeSpeed = (gap: number) => Math.sqrt(2 * TRAFFIC.brakeDecel * Math.max(0, gap - TRAFFIC.stopGap));

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface Box {
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
}

export interface Obstacle extends Box {
  speed: number; // m/s along the road
}

export class Traffic {
  readonly group = new THREE.Group();
  private readonly cars: TrafficCar[] = [];
  /** blocked lanes (roadblocks) that traffic stops behind; set every frame */
  walls: LaneWall[] = [];

  constructor() {
    const totalWeight = TRAFFIC_KINDS.reduce((s, k) => s + k.weight, 0);
    for (let i = 0; i < TRAFFIC.poolSize; i++) {
      // deterministic mix across the pool, proportional to weight
      let r = ((i + 0.5) / TRAFFIC.poolSize) * totalWeight;
      const entry = TRAFFIC_KINDS.find((k) => (r -= k.weight) <= 0) ?? TRAFFIC_KINDS[0];
      const model = buildVehicle(entry.kind);
      model.group.visible = false;
      model.group.userData.speedRange = entry.speedKmh;
      this.group.add(model.group);
      this.cars.push({ model, active: false, lane: 0, cruise: 0, speed: 0, passed: false });
    }
  }

  get activeCount(): number {
    return this.cars.reduce((n, c) => n + (c.active ? 1 : 0), 0);
  }

  reset(): void {
    for (const c of this.cars) this.deactivate(c);
    // pre-fill the visible road so the run starts with traffic ahead
    for (let attempt = 0; attempt < 200 && this.activeCount < TRAFFIC.baseCount; attempt++) {
      this.trySpawn(rand(-TRAFFIC.spawnMax, -70));
    }
  }

  private deactivate(c: TrafficCar): void {
    c.active = false;
    c.model.group.visible = false;
  }

  private laneIsClear(lane: number, z: number, length: number): boolean {
    return this.cars.every(
      (c) => !c.active || c.lane !== lane || Math.abs(c.model.group.position.z - z) > TRAFFIC.minLaneGap + length / 2,
    );
  }

  /** Never let vehicles line up across every lane: there must be a way through. */
  private leavesAGap(lane: number, z: number): boolean {
    const blocked = new Set<number>([lane]);
    for (const c of this.cars) {
      if (c.active && Math.abs(c.model.group.position.z - z) < 18) blocked.add(c.lane);
    }
    return blocked.size < LANE_COUNT - 1;
  }

  private trySpawn(z: number): boolean {
    const free = this.cars.filter((c) => !c.active);
    if (free.length === 0) return false;
    const car = pick(free);
    const lane = Math.floor(Math.random() * LANE_COUNT);
    if (!this.laneIsClear(lane, z, car.model.size.length) || !this.leavesAGap(lane, z)) return false;
    if (this.walls.some((w) => w.lane === lane && Math.abs(w.z - z) < 40)) return false;

    const [lo, hi] = car.model.group.userData.speedRange as [number, number];
    car.active = true;
    car.lane = lane;
    car.cruise = rand(lo, hi) * KMH;
    car.speed = car.cruise;
    car.passed = false;
    car.model.group.position.set(laneCenter(lane), 0, z);
    car.model.group.visible = true;
    return true;
  }

  update(dt: number, playerSpeed: number, distanceKm: number): void {
    const active = this.cars.filter((c) => c.active);

    for (const car of active) {
      const z = car.model.group.position.z;
      // nearest vehicle ahead in the same lane (ahead = more negative z)
      let leader: TrafficCar | null = null;
      let leaderGap = Infinity;
      for (const other of active) {
        if (other === car || other.lane !== car.lane) continue;
        const oz = other.model.group.position.z;
        if (oz >= z) continue;
        const gap = z - car.model.size.length / 2 - (oz + other.model.size.length / 2);
        if (gap < leaderGap) {
          leaderGap = gap;
          leader = other;
        }
      }
      let target = leader && leaderGap < TRAFFIC.followGap ? Math.min(car.cruise, leader.speed * 0.98) : car.cruise;
      // never closer than the braking distance to a stopped leader or a roadblock
      if (leader) target = Math.min(target, leader.speed + brakeSpeed(leaderGap));
      for (const w of this.walls) {
        if (w.lane === car.lane && w.z < z) target = Math.min(target, brakeSpeed(z - car.model.size.length / 2 - w.z));
      }
      car.speed += (target - car.speed) * ease(target < car.speed ? 5.22 : 2.03, dt);

      car.model.group.position.z += (playerSpeed - car.speed) * dt;
      spinWheels(car.model, car.speed, dt);

      const nz = car.model.group.position.z;
      if (nz > TRAFFIC.despawnBehind || nz < -TRAFFIC.spawnMax - 150) this.deactivate(car);
    }

    const target = Math.min(TRAFFIC.maxCount, TRAFFIC.baseCount + distanceKm * TRAFFIC.countPerKm);
    if (this.activeCount < target) this.trySpawn(-rand(TRAFFIC.spawnMin, TRAFFIC.spawnMax));
  }

  /** Active vehicles as collision boxes, for the police to steer around. */
  obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const c of this.cars) {
      if (!c.active) continue;
      const p = c.model.group.position;
      out.push({ x: p.x, z: p.z, halfWidth: c.model.size.width / 2, halfLength: c.model.size.length / 2, speed: c.speed });
    }
    return out;
  }

  /**
   * Counts vehicles the player just overtook with less than SCORE.nearMissGap
   * of side clearance. Call once per frame after update(); each vehicle counts
   * at most once, when its centre passes the player's.
   */
  nearMisses(playerX: number, playerHalfWidth: number): number {
    let n = 0;
    for (const c of this.cars) {
      if (!c.active || c.passed || c.model.group.position.z < 0) continue;
      c.passed = true;
      const gap = Math.abs(c.model.group.position.x - playerX) - c.model.size.width / 2 - playerHalfWidth;
      if (gap > 0 && gap < SCORE.nearMissGap) n++;
    }
    return n;
  }

  /** Returns the x-offset sign of the first vehicle overlapping the box, or 0. */
  collide(b: Box): number {
    for (const c of this.cars) {
      if (!c.active) continue;
      const p = c.model.group.position;
      const hw = (c.model.size.width / 2) * 0.92;
      const hl = (c.model.size.length / 2) * 0.95;
      if (Math.abs(p.x - b.x) < hw + b.halfWidth && Math.abs(p.z - b.z) < hl + b.halfLength) {
        return Math.sign(b.x - p.x) || 1;
      }
    }
    return 0;
  }
}
