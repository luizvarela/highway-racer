import * as THREE from "three";
import { KMH, PLAYER, RAIL_X } from "./config";
import type { InputState } from "./input";
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
  readonly model: VehicleModel;
  speed = PLAYER.startSpeedKmh * KMH; // m/s
  x = 0;
  private lateralVel = 0;
  private crashSpin = 0;
  crashed = false;

  constructor() {
    this.model = buildVehicle("sedan-sports");
    // neon underglow: an additive quad under the car that bloom picks up
    const { width, length } = this.model.size;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.5, length * 1.15).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        map: underglowTexture(),
      }),
    );
    glow.position.y = 0.03;
    this.model.group.add(glow);
    // headlight cone onto the road ahead
    const head = new THREE.SpotLight(0xfff1d6, 60, 70, 0.5, 0.6, 1.2);
    head.position.set(0, 0.8, -length / 2);
    head.target.position.set(0, 0, -30);
    this.model.group.add(head, head.target);
  }

  get object(): THREE.Group {
    return this.model.group;
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
    this.object.position.set(0, 0, 0);
    this.object.rotation.set(0, 0, 0);
  }

  crash(impactSide: number): void {
    this.crashed = true;
    this.crashSpin = (impactSide || 1) * (1.5 + this.speed * 0.05);
    this.speed *= 0.45;
  }

  update(dt: number, input: InputState): void {
    const max = PLAYER.maxSpeedKmh * KMH;
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
        this.speed += PLAYER.accel * input.throttle * (1 - t * t) * dt;
      } else {
        this.speed -= PLAYER.coastDecel * dt;
      }
      this.speed = THREE.MathUtils.clamp(this.speed, min, max);

      // steering authority grows with speed, so low-speed lane changes feel heavy
      const authority = THREE.MathUtils.clamp(this.speed / (90 * KMH), 0.45, 1);
      const targetVel = input.steer * PLAYER.steerSpeed * authority;
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
