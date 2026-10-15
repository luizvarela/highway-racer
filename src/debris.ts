import * as THREE from "three";
import { buildProp, type PropKind } from "./vehicles";

// Flying car parts (Kenney debris props) and spark bursts for crashes,
// takedowns and blown tyres. Pooled; positions are relative to the player.

export const DEBRIS_KINDS: PropKind[] = [
  "debris-bumper", "debris-door", "debris-door-window", "debris-tire",
  "debris-plate-a", "debris-plate-small-a", "debris-spoiler-a", "debris-bolt",
];

const PIECES = 28;
const SPARKS = 160;
const GRAVITY = 22;

interface Piece {
  obj: THREE.Object3D;
  active: boolean;
  vel: THREE.Vector3; // x, y, and forward world speed in z (m/s along -z)
  spin: THREE.Vector3;
  life: number;
}

export class Debris {
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private readonly sparkPos = new Float32Array(SPARKS * 3);
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly sparkLife = new Float32Array(SPARKS);
  private readonly sparks: THREE.Points;
  private nextSpark = 0;

  constructor() {
    for (let i = 0; i < PIECES; i++) {
      const obj = buildProp(DEBRIS_KINDS[i % DEBRIS_KINDS.length]);
      obj.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
      obj.visible = false;
      this.group.add(obj);
      this.pieces.push({ obj, active: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    const geo = new THREE.BufferGeometry();
    this.sparkPos.fill(-100);
    geo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffb040, size: 0.22, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  reset(): void {
    for (const p of this.pieces) {
      p.active = false;
      p.obj.visible = false;
    }
    this.sparkLife.fill(0);
    this.sparkPos.fill(-100);
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  /** Parts fly off a vehicle at (x, z) moving forward at `speed` m/s. */
  burst(x: number, z: number, speed: number, count: number, power = 1): void {
    const free = this.pieces.filter((p) => !p.active).sort(() => Math.random() - 0.5);
    for (const p of free.slice(0, count)) {
      p.active = true;
      p.life = 0;
      p.obj.visible = true;
      p.obj.position.set(x + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.6, z + (Math.random() - 0.5) * 3);
      p.obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.vel.set((Math.random() - 0.5) * 12 * power, (4 + Math.random() * 7) * power, speed * (0.55 + Math.random() * 0.4));
      p.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
    }
    this.spark(x, 0.5, z, 50 * power, speed);
  }

  /** A shower of `count` sparks from a point moving forward at `speed` m/s. */
  spark(x: number, y: number, z: number, count: number, speed: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      this.sparkPos.set([x + (Math.random() - 0.5) * 0.8, y, z], i * 3);
      this.sparkVel.set([(Math.random() - 0.5) * 9, 1 + Math.random() * 5, speed * (0.5 + Math.random() * 0.4)], i * 3);
      this.sparkLife[i] = 0.25 + Math.random() * 0.45;
    }
  }

  update(dt: number, playerSpeed: number): void {
    for (const p of this.pieces) {
      if (!p.active) continue;
      p.life += dt;
      const o = p.obj.position;
      p.vel.y -= GRAVITY * dt;
      o.x += p.vel.x * dt;
      o.y += p.vel.y * dt;
      o.z += (playerSpeed - p.vel.z) * dt;
      if (o.y < 0.15) {
        // bounce and scrape along the asphalt
        o.y = 0.15;
        p.vel.y = Math.abs(p.vel.y) > 2 ? -p.vel.y * 0.35 : 0;
        p.vel.x *= 0.7;
        p.vel.z *= 0.8;
        p.spin.multiplyScalar(0.6);
      }
      p.obj.rotation.x += p.spin.x * dt;
      p.obj.rotation.y += p.spin.y * dt;
      p.obj.rotation.z += p.spin.z * dt;
      if (o.z > 40 || o.z < -300 || p.life > 8) {
        p.active = false;
        p.obj.visible = false;
      }
    }

    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      const k = i * 3;
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[k + 1] = -100;
        continue;
      }
      this.sparkVel[k + 1] -= GRAVITY * 0.6 * dt;
      this.sparkPos[k] += this.sparkVel[k] * dt;
      this.sparkPos[k + 1] = Math.max(0.05, this.sparkPos[k + 1] + this.sparkVel[k + 1] * dt);
      this.sparkPos[k + 2] += (playerSpeed - this.sparkVel[k + 2]) * dt;
    }
    if (any) this.sparks.geometry.attributes.position.needsUpdate = true;
  }
}
