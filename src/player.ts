import * as THREE from "three";
import { KMH, PLAYER, RAIL_X } from "./config";
import type { InputState } from "./input";
import type { CarDef, CarStats } from "./cars";
import { buildVehicle, spinWheels, type VehicleModel } from "./vehicles";

function underglowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Arcade handling: speed is 1-D along the road, steering is a lateral velocity.
// No rigid-body physics needed for a lane racer.

export class Player {
  readonly object = new THREE.Group();
  model!: VehicleModel;
  stats!: CarStats;
  speed = PLAYER.startSpeedKmh * KMH; // m/s
  x = 0;
  private lateralVel = 0;
  private crashSpin = 0;
  crashed = false;
  private flatTimer = 0; // seconds of blown tyres left
  private flatCap = 0; // m/s top speed while flat
  private wobble = 0;
  private readonly glowMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: underglowTexture(),
  });

  /** Swap the body and handling for a garage car. */
  setCar(car: CarDef, stats: CarStats): void {
    if (this.model) this.object.remove(this.model.group);
    this.model = buildVehicle(car.model);
    this.stats = stats;
    this.glowMat.color.setHex(car.glow);

    // neon underglow: an additive quad under the car that bloom picks up
    const { width, length } = this.model.size;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, length * 1.15).rotateX(-Math.PI / 2), this.glowMat);
    glow.position.y = 0.03;
    this.model.group.add(glow);
    // headlight cone onto the road ahead
    const head = new THREE.SpotLight(0xfff1d6, 60, 70, 0.5, 0.6, 1.2);
    head.position.set(0, 0.8, -length / 2);
    head.target.position.set(0, 0, -30);
    this.model.group.add(head, head.target);
    this.object.add(this.model.group);
  }

  get maxSpeed(): number {
    const top = this.stats.topSpeedKmh * KMH;
    return this.flatTimer > 0 ? Math.min(top, this.flatCap) : top;
  }

  get tiresBlown(): boolean {
    return this.flatTimer > 0;
  }

  /** Spike strip: lose speed now, limp along with a capped top speed for a while. */
  blowTires(seconds: number, capKmh: number, speedKept: number): void {
    this.flatTimer = seconds;
    this.flatCap = capKmh * KMH;
    this.speed *= speedKept;
  }

  get halfWidth(): number {
    return this.model.size.width / 2;
  }

  get halfLength(): number {
    return this.model.size.length / 2;
  }

  get speedKmh(): number {
    return this.speed / KMH;
  }

  reset(): void {
    this.speed = PLAYER.startSpeedKmh * KMH;
    this.x = 0;
    this.lateralVel = 0;
    this.crashSpin = 0;
    this.crashed = false;
    this.flatTimer = 0;
    this.object.position.set(0, 0, 0);
    this.object.rotation.set(0, 0, 0);
  }

  crash(impactSide: number): void {
    this.crashed = true;
    this.crashSpin = (impactSide || 1) * (1.5 + this.speed * 0.05);
    this.speed *= 0.45;
  }

  /** Busted: the car coasts to a stop without spinning. */
  pullOver(): void {
    this.crashed = true;
    this.crashSpin = 0;
    this.lateralVel = 0;
  }

  /** Side contact with a police car: shoved away from it and scrubs speed. */
  bump(side: number): void {
    this.lateralVel = side * 6;
    this.speed = Math.max(PLAYER.minSpeedKmh * KMH, this.speed * 0.93);
  }

  update(dt: number, input: InputState): void {
    const max = this.maxSpeed;
    const min = PLAYER.minSpeedKmh * KMH;

    if (this.crashed) {
      this.speed = Math.max(0, this.speed - 18 * dt);
      this.crashSpin *= Math.exp(-2.5 * dt);
      this.object.rotation.y += this.crashSpin * dt;
      this.x += this.lateralVel * dt;
      this.lateralVel *= Math.exp(-3 * dt);
    } else {
      if (input.brake > 0) {
        this.speed -= PLAYER.brake * input.brake * dt;
      } else if (input.throttle > 0) {
        const t = this.speed / max;
        this.speed += this.stats.accel * input.throttle * (1 - t * t) * dt;
      } else {
        this.speed -= PLAYER.coastDecel * dt;
      }
      // over the cap (just spiked, or flat): shed speed fast but not instantly
      if (this.speed > max) this.speed = Math.max(max, this.speed - PLAYER.brake * 0.5 * dt);
      this.speed = Math.max(min, this.speed);

      // steering authority grows with speed, so low-speed lane changes feel heavy
      const authority = THREE.MathUtils.clamp(this.speed / (90 * KMH), 0.45, 1);
      let targetVel = input.steer * this.stats.steerSpeed * authority;
      if (this.flatTimer > 0) {
        // flat tyres: the car tugs from side to side
        this.flatTimer -= dt;
        this.wobble += dt;
        targetVel = targetVel * 0.7 + Math.sin(this.wobble * 9) * 1.6;
      }
      this.lateralVel += (targetVel - this.lateralVel) * Math.min(1, PLAYER.steerResponse * dt);
      this.x += this.lateralVel * dt;

      // guard rails: clamp and scrub some speed instead of crashing
      const limit = RAIL_X - this.halfWidth - 0.15;
      if (Math.abs(this.x) > limit) {
        this.x = Math.sign(this.x) * limit;
        this.lateralVel = 0;
        this.speed = Math.max(min, this.speed - 15 * dt);
      }

      // visual yaw and body roll from lateral motion
      this.object.rotation.y = -this.lateralVel * 0.035;
      this.object.rotation.z = this.lateralVel * 0.012;
    }

    this.object.position.x = this.x;
    spinWheels(this.model, this.speed, dt);
  }
}
