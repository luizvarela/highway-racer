import * as THREE from "three";
import { HAZARDS, LANE_COUNT, LANE_WIDTH, RAIL_X, laneCenter } from "./config";
import type { Box, Obstacle } from "./traffic";
import { buildProp, buildVehicle, type VehicleModel } from "./vehicles";

// Roadblocks and spike strips. They stand still on the road, so relative to
// the player they move back at the player's speed. Positions are relative to
// the player like traffic (ahead = negative z).

export type HazardKind = "spikes" | "roadblock";

interface Hazard {
  kind: HazardKind;
  active: boolean;
  z: number;
  lanes: boolean[]; // covered (spikes) or blocked (roadblock) lanes
  group: THREE.Group;
  parts: THREE.Object3D[]; // one per lane
  done: boolean; // spikes: already hit; roadblock: already passed or hit
}

export interface HazardWarning {
  kind: HazardKind;
  distance: number;
  lanes: boolean[];
}

export interface HazardEvents {
  roadblocksPassed: number;
}

export interface LaneWall {
  lane: number;
  z: number; // the wall's edge facing the player
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const STRIP_DEPTH = 0.6;

function spikeStrip(): THREE.Group {
  const g = new THREE.Group();
  const len = LANE_WIDTH - 0.3;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.06, STRIP_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x15151a, emissive: 0xff7a00, emissiveIntensity: 0.6 }),
  );
  base.position.y = 0.03;
  g.add(base);
  // two rows of spikes with glinting tips so the strip reads at night
  const spike = new THREE.ConeGeometry(0.06, 0.2, 5);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, emissive: 0xffe0a0, emissiveIntensity: 1.6, metalness: 0.6 });
  const count = 14;
  const mesh = new THREE.InstancedMesh(spike, spikeMat, count * 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count * 2; i++) {
    const x = -len / 2 + ((i % count) + 0.5) * (len / count) + (i >= count ? len / count / 2 : 0);
    m.makeTranslation(Math.min(len / 2 - 0.05, x), 0.16, i < count ? -0.14 : 0.14);
    mesh.setMatrixAt(i, m);
  }
  g.add(mesh);
  return g;
}

export class Hazards {
  readonly group = new THREE.Group();
  private readonly pool: Hazard[] = [];
  private readonly beacon = new THREE.PointLight(0x2050ff, 0, 40, 1.4); // fixed light count, see Police
  private spikeTimer = 0;
  private roadblockTimer = 0;
  private flashTime = 0;

  constructor(private readonly barMats: THREE.Material[]) {
    for (let i = 0; i < 3; i++) this.pool.push(this.make("spikes"));
    for (let i = 0; i < 2; i++) this.pool.push(this.make("roadblock"));
    this.beacon.position.y = 3;
    this.group.add(this.beacon);
  }

  private make(kind: HazardKind): Hazard {
    const group = new THREE.Group();
    const parts: THREE.Object3D[] = [];
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const part = kind === "spikes" ? spikeStrip() : this.parkedCop();
      group.add(part);
      parts.push(part);
    }
    if (kind === "roadblock") {
      // cones on both shoulders
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const cone = buildProp("cone");
          cone.scale.setScalar(1.4);
          cone.position.set(side * (RAIL_X - 0.5), cone.userData.size.y * 0.7, (k - 0.5) * 3);
          group.add(cone);
        }
      }
    }
    group.visible = false;
    this.group.add(group);
    return { kind, active: false, z: 0, lanes: [], group, parts, done: false };
  }

  /** A police car parked across a lane, light bar on. */
  private parkedCop(): THREE.Group {
    const model: VehicleModel = buildVehicle("police");
    const { width, height } = model.size;
    const bar = new THREE.BoxGeometry(1, 1, 1);
    this.barMats.forEach((mat, side) => {
      const m = new THREE.Mesh(bar, mat);
      m.scale.set(width * 0.3, 0.14, 0.32);
      m.position.set((side === 0 ? -1 : 1) * width * 0.17, height + 0.05, 0.1);
      model.group.add(m);
    });
    model.group.rotation.y = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(model.group);
    holder.userData.size = model.size;
    return holder;
  }

  reset(): void {
    for (const h of this.pool) this.deactivate(h);
    this.spikeTimer = rand(...HAZARDS.spikes.interval);
    this.roadblockTimer = rand(...HAZARDS.roadblock.interval);
    this.beacon.intensity = 0;
  }

  /** Clear the road (after an escape the police pack up). */
  clearAhead(): void {
    for (const h of this.pool) if (h.active && h.z < -40) this.deactivate(h);
  }

  private deactivate(h: Hazard): void {
    h.active = false;
    h.group.visible = false;
  }

  /**
   * Park one cop per blocked lane. The two beside the gap line up with its
   * edges (HAZARDS.roadblock.gap wide); one that would poke through the rail
   * parks lengthwise instead. Others sit sideways in their lane.
   */
  private parkRoadblock(h: Hazard, open: number): void {
    const gapLeft = Math.max(-RAIL_X, laneCenter(open) - HAZARDS.roadblock.gap / 2);
    const gapRight = Math.min(RAIL_X, laneCenter(open) + HAZARDS.roadblock.gap / 2);
    h.parts.forEach((p, lane) => {
      p.visible = h.lanes[lane];
      const { width, length } = p.userData.size as { width: number; length: number };
      let x = laneCenter(lane);
      let sideways = true;
      const side = lane < open ? -1 : 1;
      if (Math.abs(lane - open) === 1) {
        const edge = side < 0 ? gapLeft : gapRight;
        x = edge + side * (length / 2);
        if (Math.abs(x) + length / 2 > RAIL_X) {
          sideways = false;
          x = edge + side * (width / 2);
        }
      }
      if (sideways) x = THREE.MathUtils.clamp(x, -(RAIL_X - length / 2), RAIL_X - length / 2);
      const tilt = lane % 2 ? 0.08 : -0.08;
      p.position.set(x, 0, lane % 2 ? 0.6 : -0.6);
      p.rotation.y = sideways ? tilt : Math.PI / 2 + tilt * 2; // the model inside is already turned sideways
      // collision box in road axes; a lengthwise car also closes the slot between it and the rail
      p.userData.box = sideways
        ? { x, hx: length / 2, hz: width / 2 }
        : { x: (x - (side * width) / 2 + side * RAIL_X) / 2, hx: (RAIL_X - Math.abs(x - (side * width) / 2)) / 2, hz: length / 2 };
    });
  }

  /** Place a hazard `distance` metres ahead (the timers use HAZARDS.spawnAhead; tests call this directly). */
  spawn(kind: HazardKind, playerLane: number, distance: number = HAZARDS.spawnAhead): boolean {
    const z = -distance;
    if (this.pool.some((h) => h.active && Math.abs(h.z - z) < HAZARDS.minSpacing)) return false;
    const h = this.pool.find((p) => p.kind === kind && !p.active);
    if (!h) return false;

    if (kind === "roadblock") {
      const open = Math.floor(Math.random() * LANE_COUNT);
      h.lanes = Array.from({ length: LANE_COUNT }, (_, l) => l !== open);
      this.parkRoadblock(h, open);
    } else {
      // the strip goes where the player is now, sometimes across a neighbour lane too
      h.lanes = Array.from({ length: LANE_COUNT }, (_, l) => l === playerLane);
      if (Math.random() < 0.5) {
        const other = playerLane === 0 ? 1 : playerLane === LANE_COUNT - 1 ? LANE_COUNT - 2 : playerLane + (Math.random() < 0.5 ? -1 : 1);
        h.lanes[other] = true;
      }
      h.parts.forEach((p, lane) => {
        p.visible = h.lanes[lane];
        p.position.set(laneCenter(lane), 0, 0);
      });
    }
    h.z = z;
    h.done = false;
    h.active = true;
    h.group.position.set(0, 0, z);
    h.group.visible = true;
    return true;
  }

  update(dt: number, playerSpeed: number, playerX: number, playerHalfLength: number, level: number, chased: boolean, running: boolean): HazardEvents {
    const ev: HazardEvents = { roadblocksPassed: 0 };
    if (running && chased) {
      const lane = THREE.MathUtils.clamp(Math.round(playerX / LANE_WIDTH + (LANE_COUNT - 1) / 2), 0, LANE_COUNT - 1);
      if (level >= HAZARDS.spikes.minLevel && (this.spikeTimer -= dt) <= 0) {
        this.spikeTimer = this.spawn("spikes", lane) ? rand(...HAZARDS.spikes.interval) : 2;
      }
      if (level >= HAZARDS.roadblock.minLevel && (this.roadblockTimer -= dt) <= 0) {
        this.roadblockTimer = this.spawn("roadblock", lane) ? rand(...HAZARDS.roadblock.interval) : 2;
      }
    }

    let nearestBlock: Hazard | null = null;
    for (const h of this.pool) {
      if (!h.active) continue;
      h.z += playerSpeed * dt;
      h.group.position.z = h.z;
      if (h.kind === "roadblock") {
        if (!h.done && running && h.z - 1.5 > playerHalfLength) {
          h.done = true;
          ev.roadblocksPassed++;
        }
        if (h.z < 20 && (!nearestBlock || h.z > nearestBlock.z)) nearestBlock = h;
      }
      if (h.z > 60) this.deactivate(h);
    }

    // a blue wash on the road around the nearest roadblock, flashing with the bars
    this.flashTime += dt;
    const on = (this.flashTime * 2.2) % 0.5 < 0.12;
    this.beacon.intensity = nearestBlock ? (on ? 60 : 8) : 0;
    if (nearestBlock) this.beacon.position.set(0, 3, nearestBlock.z - 4);
    return ev;
  }

  private boxes(h: Hazard): Box[] {
    const out: Box[] = [];
    h.parts.forEach((p, lane) => {
      if (!h.lanes[lane]) return;
      if (h.kind === "spikes") {
        out.push({ x: p.position.x, z: h.z, halfWidth: LANE_WIDTH / 2, halfLength: STRIP_DEPTH / 2 });
      } else {
        const box = p.userData.box as { x: number; hx: number; hz: number };
        out.push({ x: box.x, z: h.z + p.position.z, halfWidth: box.hx, halfLength: box.hz });
      }
    });
    return out;
  }

  /** Everything on the road, as obstacles for the police to steer around (or crash into). */
  obstacles(): Obstacle[] {
    const out: Obstacle[] = [];
    for (const h of this.pool) if (h.active) for (const b of this.boxes(h)) out.push({ ...b, speed: 0 });
    return out;
  }

  /** Blocked lanes, for traffic to queue behind. */
  walls(): LaneWall[] {
    const out: LaneWall[] = [];
    for (const h of this.pool) {
      if (!h.active || h.kind !== "roadblock") continue;
      h.lanes.forEach((blocked, lane) => blocked && out.push({ lane, z: h.z + 1.6 }));
    }
    return out;
  }

  /** Player contact: crashing into a roadblock (returns side), or running over spikes (once per strip). */
  collide(b: Box): { roadblock: number; spikes: boolean } {
    const res = { roadblock: 0, spikes: false };
    for (const h of this.pool) {
      if (!h.active) continue;
      for (const o of this.boxes(h)) {
        const hitX = Math.abs(o.x - b.x) < o.halfWidth + b.halfWidth * (h.kind === "spikes" ? 0.7 : 1);
        if (!hitX || Math.abs(o.z - b.z) >= o.halfLength + b.halfLength) continue;
        if (h.kind === "roadblock") {
          h.done = true;
          res.roadblock = Math.sign(b.x - o.x) || 1;
        } else if (!h.done) {
          h.done = true;
          res.spikes = true;
        }
      }
    }
    return res;
  }

  /** The nearest hazard ahead within warning range. */
  warning(): HazardWarning | null {
    let best: Hazard | null = null;
    for (const h of this.pool) {
      if (!h.active || h.done || h.z > 0 || -h.z > HAZARDS.warnDistance) continue;
      if (!best || h.z > best.z) best = h;
    }
    return best ? { kind: best.kind, distance: -best.z, lanes: best.lanes } : null;
  }

  snapshot(): { kind: HazardKind; z: number; lanes: boolean[] }[] {
    return this.pool.filter((h) => h.active).map((h) => ({ kind: h.kind, z: h.z, lanes: [...h.lanes] }));
  }
}
