import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Vehicles come from the Kenney Car Kit (CC0, public/models/kenney/LICENSE.txt).
// Each GLB has a "body" mesh and four "wheel-*" nodes and faces +Z; we wrap it
// so every vehicle faces -Z, sits on y = 0 and has a real-world length.

export type VehicleKind =
  | "sedan" | "sedan-sports" | "hatchback-sports" | "suv" | "suv-luxury" | "taxi"
  | "van" | "delivery" | "truck" | "truck-flat" | "garbage-truck" | "ambulance"
  | "firetruck" | "police" | "race-future"
  | "hero-comet" | "hero-viper" | "hero-bruiser" | "hero-phantom" | "hero-bus" | "hero-truck";

const LENGTH_M: Record<VehicleKind, number> = {
  sedan: 4.6, "sedan-sports": 4.5, "hatchback-sports": 4.1, suv: 4.8, "suv-luxury": 4.9, taxi: 4.6,
  van: 5.2, delivery: 6.2, truck: 6.8, "truck-flat": 6.8, "garbage-truck": 8.2, ambulance: 6.0,
  firetruck: 9.0, police: 4.8, "race-future": 4.4,
  "hero-comet": 4.6, "hero-viper": 4.1, "hero-bruiser": 4.9, "hero-phantom": 4.5,
  "hero-bus": 12, "hero-truck": 7.2,
};

// Hero models: AI-generated (Tripo) and shrunk by scripts/import-model.sh.
// They live next to the kit folder, are one mesh with baked-in wheels, and
// face +Z like the kit models.
const HERO_FILES: Partial<Record<VehicleKind, string>> = {
  "hero-comet": "../hero/comet.glb",
  "hero-viper": "../hero/viper.glb",
  "hero-bruiser": "../hero/bruiser.glb",
  "hero-phantom": "../hero/phantom.glb",
  police: "../hero/police.glb", // yaw 90 at import
  "hero-bus": "../hero/bus.glb", // yaw 90 at import; traffic models are imported at a third of the detail
  "hero-truck": "../hero/truck.glb",
  taxi: "../hero/taxi.glb",
  suv: "../hero/suv.glb", // yaw 90 at import
  "hatchback-sports": "../hero/hatchback.glb", // yaw 90 at import
};
const isHero = (kind: VehicleKind) => kind in HERO_FILES;
// light paint goes past the bloom threshold under the neon reflections: dim it
const HERO_SHADE: Partial<Record<VehicleKind, number>> = { "hero-viper": 0.72, "hero-truck": 0.75, taxi: 0.85 };

/** Reflections for the glossy hero paint: a dark room with neon strips. */
let heroEnv: THREE.Texture | null = null;
export function setVehicleEnvironment(renderer: THREE.WebGLRenderer): void {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x1a1030, side: THREE.BackSide })));
  const strip = (color: number, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    room.add(m);
  };
  strip(0xfff1e0, 4, 0.3, 30, 0, 9, 0); // street lamps overhead
  strip(0xff2bd6, 0.3, 1.2, 36, -19, 2, 0); // neon on either side
  strip(0x00e5ff, 0.3, 1.2, 36, 19, 2, 0);
  strip(0x3a2a70, 40, 0.2, 40, 0, -9.8, 0); // faint road bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  heroEnv = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  for (const [kind, t] of templates) if (isHero(kind)) applyEnv(t, kind);
}

function applyEnv(root: THREE.Object3D, kind: VehicleKind): void {
  if (!heroEnv) return;
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat?.isMeshStandardMaterial) {
      mat.color.setScalar(HERO_SHADE[kind] ?? 1);
      // gloss is set at import (scripts/strip-maps.mjs): an even paint finish
      mat.envMap = heroEnv;
      mat.envMapIntensity = 1.4;
      mat.needsUpdate = true;
    }
  });
}

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
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(
    [...new Set(kinds)].map(async (kind) => {
      const gltf = await loader.loadAsync(`${baseUrl}${HERO_FILES[kind] ?? `${kind}.glb`}`);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      if (isHero(kind)) applyEnv(gltf.scene, kind);
      templates.set(kind, gltf.scene);
    }),
  );
}

// Props from the same kit (debris, cones), at the same scale as the cars.
export type PropKind =
  | "cone" | "debris-bumper" | "debris-door" | "debris-door-window" | "debris-tire"
  | "debris-plate-a" | "debris-plate-small-a" | "debris-spoiler-a" | "debris-bolt";

const props = new Map<PropKind, THREE.Group>();

export async function loadProps(kinds: PropKind[], baseUrl: string): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    kinds.map(async (kind) => {
      const gltf = await loader.loadAsync(`${baseUrl}${kind}.glb`);
      props.set(kind, gltf.scene);
    }),
  );
}

/** Kit units to metres, taken from the sedan (load vehicles first). */
function kitScale(): number {
  const sedan = templates.get("sedan");
  if (!sedan) return 1;
  return LENGTH_M.sedan / new THREE.Box3().setFromObject(sedan).getSize(new THREE.Vector3()).z;
}

/** A prop clone centred on its own origin, in metres. */
export function buildProp(kind: PropKind): THREE.Group {
  const template = props.get(kind);
  if (!template) throw new Error(`prop "${kind}" was not loaded`);
  const inner = template.clone(true);
  const scale = kitScale();
  inner.scale.setScalar(scale);
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -c.y, -c.z);
  const group = new THREE.Group();
  group.add(inner);
  group.userData.size = box.getSize(new THREE.Vector3());
  return group;
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
  // Hero models have real light housings: sit the glow inside them instead.
  const hero = isHero(kind);
  const lightY = size.height * (hero ? 0.56 : 0.4);
  const lightDepth = 0.06;
  const gap = hero ? -0.12 : 0.03;
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(lightGeo, tailMat);
    tail.scale.set(size.width * 0.2, 0.2, lightDepth);
    tail.position.set(side * size.width * 0.32, lightY, size.length / 2 + gap + lightDepth / 2);
    const head = new THREE.Mesh(lightGeo, headMat);
    head.scale.set(size.width * 0.18, 0.16, lightDepth);
    head.position.set(side * size.width * 0.32, hero ? size.height * 0.42 : lightY * 0.9, -size.length / 2 - gap - lightDepth / 2);
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
