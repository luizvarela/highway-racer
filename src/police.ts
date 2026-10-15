import * as THREE from "three";
import { KMH, LANE_COUNT, POLICE, RAIL_X, laneCenter } from "./config";
import type { Box, Obstacle } from "./traffic";
import { buildVehicle, spinWheels, type VehicleModel } from "./vehicles";

// Police pursuit. Cops spawn behind the player and drive to a slot around
// them (tailgating or alongside), capped at a top speed set by the wanted
// level: outrun that and they fall back and lose you. They steer around
// traffic with a short look-ahead, so a tight weave can make them crash.
// Positions are relative to the player, like traffic (behind = +z).

const POOL = 6; // max count plus room for wrecks still rolling to a stop
const BAR_COLORS = [0xff1030, 0x1060ff];
const FLASH_HZ = 2.2;
const ENGAGE_Z = 60; // a cop that got this close counts as "lost" when it falls back
const CRASH_DECEL = 25; // m/s²

// where each cop wants to sit relative to the player (dx metres, dz metres behind)
const SLOTS = [
  { dx: 0, dz: 6.4 },
  { dx: -3.6, dz: 1.5 },
  { dx: 3.6, dz: 1.5 },
  { dx: 0, dz: 15 },
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const ROAD_X = RAIL_X - 1.4; // furthest a cop centre goes from the middle

interface Cop {
  model: VehicleModel;
  active: boolean;
  crashed: boolean;
  engaged: boolean;
  slot: number;
  reaction: number; // seconds of look-ahead
  x: number;
  z: number;
  speed: number; // m/s
  lateralVel: number;
  spin: number;
  dodgeX: number | null;
  dodgeTimer: number;
}

export interface Chaser {
  x: number;
  speed: number;
  halfWidth: number;
  halfLength: number;
  toughness: number; // the bust meter fills this many times slower
}

export interface PoliceEvents {
  takedowns: number;
  wrecks: { x: number; z: number; speed: number }[]; // where each takedown happened
  lost: number;
  bumpSide: number; // non-zero when a cop side-swiped the player
}

const overlaps = (a: Box, b: Box, shrink = 0.92) =>
  Math.abs(a.x - b.x) < (a.halfWidth + b.halfWidth) * shrink && Math.abs(a.z - b.z) < (a.halfLength + b.halfLength) * shrink;

export class Police {
  readonly group = new THREE.Group();
  private readonly cops: Cop[] = [];
  /** light-bar materials, shared with the roadblock cars so they flash in sync */
  readonly barMats = BAR_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 6 }),
  );
  // one red and one blue light that follow the nearest cop and wash the road;
  // a fixed count so materials never recompile mid-run
  private readonly lights = BAR_COLORS.map((c) => new THREE.PointLight(c, 0, 26, 1.6));
  private flashTime = 0;
  private spawnTimer = 0;
  /** 0..1; full means busted */
  bust = 0;
  /** metres to the nearest active cop (behind is positive), or null */
  nearest: number | null = null;

  constructor() {
    const barGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < POOL; i++) {
      const model = buildVehicle("police");
      const { width, height } = model.size;
      BAR_COLORS.forEach((_, side) => {
        const bar = new THREE.Mesh(barGeo, this.barMats[side]);
        bar.scale.set(width * 0.3, 0.14, 0.32);
        bar.position.set((side === 0 ? -1 : 1) * width * 0.17, height + 0.05, 0.1);
        model.group.add(bar);
      });
      model.group.visible = false;
      this.group.add(model.group);
      this.cops.push({
        model, active: false, crashed: false, engaged: false, slot: 0, reaction: 1,
        x: 0, z: 0, speed: 0, lateralVel: 0, spin: 0, dodgeX: null, dodgeTimer: 0,
      });
    }
    for (const l of this.lights) {
      l.position.y = 2.2;
      this.group.add(l);
    }
  }

  get activeCount(): number {
    return this.cops.reduce((n, c) => n + (c.active && !c.crashed ? 1 : 0), 0);
  }

  /** read-only snapshot for tests and debugging */
  snapshot(): { x: number; z: number; kmh: number; crashed: boolean }[] {
    return this.cops.filter((c) => c.active).map((c) => ({ x: c.x, z: c.z, kmh: c.speed / KMH, crashed: c.crashed }));
  }

  reset(): void {
    for (const c of this.cops) this.deactivate(c);
    this.spawnTimer = POLICE.firstSpawnDelay;
    this.bust = 0;
    this.nearest = null;
    for (const l of this.lights) l.intensity = 0;
  }

  /** After an escape: the chasing cops give up and the next one waits `delay` seconds. Wrecks keep rolling. */
  standDown(delay: number): void {
    for (const c of this.cops) if (c.active && !c.crashed) this.deactivate(c);
    this.spawnTimer = delay;
    this.bust = 0;
  }

  private deactivate(c: Cop): void {
    c.active = false;
    c.model.group.visible = false;
  }

  private spawn(level: number, obstacles: Obstacle[]): void {
    const cop = this.cops.find((c) => !c.active);
    if (!cop) return;
    const used = new Set(this.cops.filter((c) => c.active && !c.crashed).map((c) => c.slot));
    cop.slot = SLOTS.findIndex((_, i) => !used.has(i));
    if (cop.slot < 0) return;

    const lanes = [...Array(LANE_COUNT).keys()].sort(() => Math.random() - 0.5);
    const z = POLICE.spawnBehind;
    const lane = lanes.find((l) => obstacles.every((o) => Math.abs(o.x - laneCenter(l)) > 2.5 || Math.abs(o.z - z) > 20));
    cop.x = laneCenter(lane ?? lanes[0]);
    cop.z = z;
    cop.speed = POLICE.maxSpeedKmh[level - 1] * KMH;
    cop.lateralVel = 0;
    cop.spin = 0;
    cop.dodgeX = null;
    cop.dodgeTimer = 0;
    cop.reaction = rand(POLICE.reaction[0], POLICE.reaction[1]);
    cop.active = true;
    cop.crashed = false;
    cop.engaged = false;
    cop.model.group.rotation.set(0, 0, 0);
    cop.model.group.visible = true;
  }

  private box(c: Cop): Box {
    return { x: c.x, z: c.z, halfWidth: c.model.size.width / 2, halfLength: c.model.size.length / 2 };
  }

  /** Is the strip of road at lateral position x clear of traffic from just behind the cop to `ahead` metres in front? */
  private clearAt(c: Cop, x: number, ahead: number, obstacles: Obstacle[]): boolean {
    const hw = c.model.size.width / 2;
    const hl = c.model.size.length / 2;
    return obstacles.every(
      (o) => Math.abs(o.x - x) > o.halfWidth + hw + 0.3 || o.z - o.halfLength > c.z + hl + 2 || o.z + o.halfLength < c.z - hl - ahead,
    );
  }

  /** Is there traffic beside the cop between its current x and x? (a lane change would side-swipe it) */
  private blockedSideways(c: Cop, x: number, obstacles: Obstacle[]): boolean {
    const hw = c.model.size.width / 2;
    const hl = c.model.size.length / 2;
    const lo = Math.min(c.x, x) - hw;
    const hi = Math.max(c.x, x) + hw;
    return obstacles.some(
      (o) => Math.abs(o.z - c.z) < o.halfLength + hl + 1.5 && o.x + o.halfWidth > lo && o.x - o.halfWidth < hi && Math.abs(o.x - c.x) > 0.5,
    );
  }

  update(dt: number, player: Chaser, level: number, obstacles: Obstacle[], running: boolean): PoliceEvents {
    const ev: PoliceEvents = { takedowns: 0, wrecks: [], lost: 0, bumpSide: 0 };
    const maxSpeed = POLICE.maxSpeedKmh[level - 1] * KMH;
    const playerBox: Box = { x: player.x, z: 0, halfWidth: player.halfWidth, halfLength: player.halfLength };

    if (running) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.activeCount < POLICE.count[level - 1]) {
        this.spawn(level, obstacles);
        this.spawnTimer = rand(POLICE.respawnDelay[0], POLICE.respawnDelay[1]);
      }
    }

    let inRange = false;
    let nearest: Cop | null = null;

    for (const c of this.cops) {
      if (!c.active) continue;
      const hl = c.model.size.length / 2;

      if (c.crashed) {
        c.speed = Math.max(0, c.speed - CRASH_DECEL * dt);
        c.spin *= Math.exp(-2 * dt);
        c.model.group.rotation.y += c.spin * dt;
        c.x += c.lateralVel * dt;
        c.lateralVel *= Math.exp(-3 * dt);
      } else {
        const slot = SLOTS[c.slot];
        const desiredX = THREE.MathUtils.clamp(player.x + slot.dx, -ROAD_X, ROAD_X);

        // speed: close the gap to the slot, never above the level's top speed
        let targetSpeed = THREE.MathUtils.clamp(player.speed + (c.z - slot.dz) * 1.2, 10 * KMH, maxSpeed);

        // look ahead for slower traffic in our path
        let blocker: Obstacle | null = null;
        let blockerGap = Infinity;
        for (const o of obstacles) {
          if (o.z >= c.z || Math.abs(o.x - c.x) > o.halfWidth + c.model.size.width / 2 + 0.25) continue;
          const gap = c.z - hl - (o.z + o.halfLength);
          if (gap > -0.5 && gap < blockerGap) {
            blockerGap = gap;
            blocker = o;
          }
        }
        c.dodgeTimer -= dt;
        if (c.dodgeTimer <= 0) c.dodgeX = null;
        if (blocker) {
          const closing = c.speed - blocker.speed;
          if (closing > 0 && blockerGap < closing * c.reaction + 3) {
            // pick the clear lane (or the slot line) closest to where we want to be
            const ahead = closing * 1.5 + 12;
            const candidates = [desiredX, ...[...Array(LANE_COUNT).keys()].map(laneCenter)]
              .filter((x) => Math.abs(x - c.x) > 1 && this.clearAt(c, x, ahead, obstacles) && !this.blockedSideways(c, x, obstacles))
              .sort((a, b) => Math.abs(a - desiredX) + Math.abs(a - c.x) * 0.5 - (Math.abs(b - desiredX) + Math.abs(b - c.x) * 0.5));
            if (candidates.length) {
              c.dodgeX = candidates[0];
              c.dodgeTimer = 1.2;
            } else {
              targetSpeed = Math.min(targetSpeed, blocker.speed);
            }
          }
        }

        const accel = targetSpeed > c.speed ? 12 : 20;
        c.speed += THREE.MathUtils.clamp(targetSpeed - c.speed, -accel * dt, accel * dt);

        let targetX = c.dodgeX ?? desiredX;
        if (c.dodgeX === null && this.blockedSideways(c, targetX, obstacles)) targetX = c.x;
        const targetVel = THREE.MathUtils.clamp((targetX - c.x) * 3, -POLICE.steerSpeed, POLICE.steerSpeed);
        c.lateralVel += (targetVel - c.lateralVel) * Math.min(1, 8 * dt);
        c.x = THREE.MathUtils.clamp(c.x + c.lateralVel * dt, -ROAD_X, ROAD_X);
        c.model.group.rotation.y = -c.lateralVel * 0.035;
      }

      c.z += (player.speed - c.speed) * dt;
      const box = this.box(c);

      if (!c.crashed) {
        // a cop that hits traffic is out of the chase
        if (obstacles.some((o) => overlaps(box, o))) {
          c.crashed = true;
          c.spin = (Math.random() < 0.5 ? -1 : 1) * (2 + c.speed * 0.04);
          c.lateralVel = (Math.random() - 0.5) * 6;
          ev.takedowns++;
          ev.wrecks.push({ x: c.x, z: c.z, speed: c.speed });
        } else if (running && overlaps(box, playerBox, 1)) {
          const dx = player.x - c.x;
          if (Math.abs(c.z) < hl + player.halfLength - 1.2) {
            // alongside: side-swipe
            ev.bumpSide = Math.sign(dx) || 1;
            c.lateralVel = -ev.bumpSide * 4;
            c.x -= ev.bumpSide * 0.15;
          } else if (c.z > 0) {
            // behind: stay on the bumper
            c.z = hl + player.halfLength + 0.3;
            c.speed = Math.min(c.speed, player.speed);
          } else {
            c.z = -(hl + player.halfLength + 0.3);
            c.speed = Math.max(c.speed, player.speed);
          }
        }

        if (c.z < ENGAGE_Z) c.engaged = true;
        if (Math.abs(c.x - player.x) < POLICE.bustRange.dx && Math.abs(c.z) < POLICE.bustRange.dz) inRange = true;
        if (!nearest || Math.abs(c.z) < Math.abs(nearest.z)) nearest = c;
      }

      if (c.z > POLICE.loseDistance) {
        if (!c.crashed && c.engaged && running) ev.lost++;
        this.deactivate(c);
        continue;
      }
      c.model.group.position.set(c.x, 0, c.z);
      spinWheels(c.model, c.speed, dt);
    }

    if (running) {
      this.bust += inRange ? dt / (POLICE.bustFillSeconds * player.toughness) : -dt / POLICE.bustDrainSeconds;
      this.bust = THREE.MathUtils.clamp(this.bust, 0, 1);
    }
    this.nearest = nearest ? nearest.z : null;
    this.flash(dt, nearest);
    return ev;
  }

  private flash(dt: number, nearest: Cop | null): void {
    this.flashTime += dt;
    // double-blink red, then double-blink blue
    const phase = (this.flashTime * FLASH_HZ) % 1;
    const blink = (p: number) => (p % 0.25 < 0.12 ? 1 : 0.08);
    const red = phase < 0.5 ? blink(phase) : 0.08;
    const blue = phase >= 0.5 ? blink(phase - 0.5) : 0.08;
    this.barMats[0].emissiveIntensity = 6 * red;
    this.barMats[1].emissiveIntensity = 6 * blue;

    const near = nearest && nearest.z < 80 ? 1 - Math.max(0, nearest.z) / 80 : 0;
    this.lights.forEach((l, i) => {
      l.intensity = 38 * near * (i === 0 ? red : blue);
      // just ahead of the cop: washes the road and the player, not the cop itself
      if (nearest) l.position.set(nearest.x + (i === 0 ? -0.6 : 0.6), 3.2, nearest.z - nearest.model.size.length / 2 - 3);
    });
  }
}
