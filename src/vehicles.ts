import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Vehicles come from the Kenney Car Kit (CC0, public/models/kenney/LICENSE.txt).
// Each GLB has a "body" mesh and four "wheel-*" nodes and faces +Z; we wrap it
// so every vehicle faces -Z, sits on y = 0 and has a real-world length.

export type VehicleKind =
  | "sedan" | "sedan-sports" | "hatchback-sports" | "suv" | "suv-luxury" | "taxi"
  | "van" | "delivery" | "truck" | "truck-flat" | "garbage-truck" | "ambulance"
  | "firetruck" | "police" | "race-future";

const LENGTH_M: Record<VehicleKind, number> = {
  sedan: 4.6, "sedan-sports": 4.5, "hatchback-sports": 4.1, suv: 4.8, "suv-luxury": 4.9, taxi: 4.6,
  van: 5.2, delivery: 6.2, truck: 6.8, "truck-flat": 6.8, "garbage-truck": 8.2, ambulance: 6.0,
  firetruck: 9.0, police: 4.8, "race-future": 4.4,
};

export interface VehicleSize {
  width: number;
  length: number;
  height: number;
}

export interface VehicleModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  size: VehicleSize;
  wheelRadius: number;
}

const templates = new Map<VehicleKind, THREE.Group>();

export async function loadVehicles(kinds: VehicleKind[], baseUrl: string): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    [...new Set(kinds)].map(async (kind) => {
      const gltf = await loader.loadAsync(`${baseUrl}${kind}.glb`);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      templates.set(kind, gltf.scene);
    }),
  );
}

const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2030, emissiveIntensity: 4 });
const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4d6, emissiveIntensity: 3 });
const lightGeo = new THREE.BoxGeometry(1, 1, 1);

export function buildVehicle(kind: VehicleKind): VehicleModel {
  const template = templates.get(kind);
  if (!template) throw new Error(`vehicle "${kind}" was not loaded`);

  const inner = template.clone(true); // shares geometry + materials with the template
  const box = new THREE.Box3().setFromObject(inner);
  const raw = box.getSize(new THREE.Vector3());
  const scale = LENGTH_M[kind] / raw.z;
  inner.scale.setScalar(scale);
  inner.rotation.y = Math.PI; // face -Z
  const center = box.getCenter(new THREE.Vector3());
  inner.position.set(center.x * scale, -box.min.y * scale, center.z * scale);

  const group = new THREE.Group();
  group.add(inner);

  const wheels: THREE.Object3D[] = [];
  inner.traverse((o) => {
    if (o.name.startsWith("wheel")) wheels.push(o);
  });
  const size = { width: raw.x * scale, length: raw.z * scale, height: raw.y * scale };

  // glowing head/tail lights so cars read at night (the atlas has no emissive).
  // Kept just outside the bounding box so they never share a plane with a
  // bumper, and tall enough to stay above one pixel at typical traffic range.
  const lightY = size.height * 0.4;
  const lightDepth = 0.06;
  const gap = 0.03;
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(lightGeo, tailMat);
    tail.scale.set(size.width * 0.2, 0.2, lightDepth);
    tail.position.set(side * size.width * 0.32, lightY, size.length / 2 + gap + lightDepth / 2);
    const head = new THREE.Mesh(lightGeo, headMat);
    head.scale.set(size.width * 0.18, 0.16, lightDepth);
    head.position.set(side * size.width * 0.32, lightY * 0.9, -size.length / 2 - gap - lightDepth / 2);
    group.add(tail, head);
  }

  // wheel nodes sit at their own centre, so their height above the ground is the radius
  const wheelRadius = wheels.length ? (wheels[0].position.y - box.min.y) * scale : 0.35;
  return { group, wheels, size, wheelRadius: wheelRadius > 0 ? wheelRadius : 0.35 };
}

export function spinWheels(model: VehicleModel, speed: number, dt: number): void {
  // models are turned 180°, so forward roll is a positive local X rotation
  const angle = (speed * dt) / model.wheelRadius;
  for (const w of model.wheels) w.rotation.x += angle;
}
