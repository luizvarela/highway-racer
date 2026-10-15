import * as THREE from "three";
import { CHUNK_COUNT, CHUNK_LENGTH, LANE_COUNT, LANE_WIDTH, RAIL_X, RECYCLE_Z, ROAD_WIDTH, SHOULDER } from "./config";

// Endless neon highway made of CHUNK_COUNT identical chunks. Each frame they
// scroll towards +Z; a chunk that passes behind the camera jumps to the front.

const ASPHALT_WIDTH = ROAD_WIDTH + SHOULDER * 2;
const GROUND_WIDTH = 320;
const NEON_CYAN = 0x00e5ff;
const NEON_PINK = 0xff2bd6;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Asphalt colour map plus a matching emissive map that holds only the lines. */
function asphaltTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const pxPerM = 24;
  const w = Math.round(ASPHALT_WIDTH * pxPerM);
  const h = 1024; // stretched over CHUNK_LENGTH metres
  const pxPerMZ = h / CHUNK_LENGTH;
  const [c, ctx] = canvas(w, h);
  const [ec, ectx] = canvas(w, h);

  ctx.fillStyle = "#16161d";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = 26 + Math.random() * 22;
    ctx.fillStyle = `rgba(${v},${v},${v + 8},0.5)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ectx.fillStyle = "#000";
  ectx.fillRect(0, 0, w, h);

  const line = 0.16 * pxPerM;
  const draw = (color: string, x: number, y: number, lw: number, lh: number) => {
    for (const [g, alpha] of [[ctx, 1], [ectx, 1]] as const) {
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.fillRect(x, y, lw, lh);
    }
  };
  // solid pink edge lines
  draw("#ff2bd6", SHOULDER * pxPerM - line, 0, line, h);
  draw("#ff2bd6", (SHOULDER + ROAD_WIDTH) * pxPerM, 0, line, h);
  // dashed cyan lane lines: 3 m dash, 9 m gap (12 m period divides CHUNK_LENGTH)
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    const x = (SHOULDER + LANE_WIDTH * lane) * pxPerM - line / 2;
    for (let z = 0; z < CHUNK_LENGTH; z += 12) draw("#7ff6ff", x, z * pxPerMZ, line, 3 * pxPerMZ);
  }

  const wrap = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: wrap(c), emissive: wrap(ec) };
}

/** Dark ground with a glowing synthwave grid; one tile = 10 m. */
function gridTexture(): THREE.CanvasTexture {
  const s = 128;
  const [c, ctx] = canvas(s, s);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#b21fd0";
  ctx.fillRect(0, 0, s, 3);
  ctx.fillRect(0, 0, 3, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(GROUND_WIDTH / 10, CHUNK_LENGTH / 10);
  t.anisotropy = 8;
  return t;
}

/** Building facade: dark wall with a random pattern of lit windows. */
function windowsTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 128, 256);
  const colors = ["#ffd27a", "#7ff6ff", "#ff7ae6", "#fff1c9"];
  for (let y = 6; y < 256; y += 12) {
    for (let x = 6; x < 128; x += 12) {
      if (Math.random() < 0.38) {
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.globalAlpha = 0.5 + Math.random() * 0.5;
        ctx.fillRect(x, y, 6, 7);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Road {
  readonly group = new THREE.Group();
  private readonly chunks: THREE.Group[] = [];

  constructor() {
    const asphalt = asphaltTextures();
    const asphaltMat = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      emissiveMap: asphalt.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
      roughness: 0.55,
      metalness: 0.2,
    });
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x07040f,
      emissive: 0xffffff,
      emissiveMap: gridTexture(),
      emissiveIntensity: 0.9,
      roughness: 1,
    });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.7, roughness: 0.35 });
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: NEON_PINK, emissiveIntensity: 3 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.6 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1f27, roughness: 0.5, metalness: 0.5 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: NEON_CYAN, emissiveIntensity: 5 });
    const facadeTex = windowsTexture();
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x0c0b16,
      emissive: 0xffffff,
      emissiveMap: facadeTex,
      emissiveIntensity: 0.75,
      roughness: 0.8,
    });
    const roofMats = [NEON_PINK, NEON_CYAN, 0xffb000].map(
      (c) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 3 }),
    );

    const asphaltGeo = new THREE.PlaneGeometry(ASPHALT_WIDTH, CHUNK_LENGTH).rotateX(-Math.PI / 2);
    const groundGeo = new THREE.PlaneGeometry(GROUND_WIDTH, CHUNK_LENGTH).rotateX(-Math.PI / 2);
    const railGeo = new THREE.BoxGeometry(0.12, 0.32, CHUNK_LENGTH);
    const tubeGeo = new THREE.BoxGeometry(0.07, 0.07, CHUNK_LENGTH);
    const postGeo = new THREE.BoxGeometry(0.12, 0.75, 0.12);
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 9, 8);
    const armGeo = new THREE.BoxGeometry(2.6, 0.12, 0.12);
    const lampGeo = new THREE.BoxGeometry(1.2, 0.1, 0.3);
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.BoxGeometry(1, 0.25, 1);

    const postSpacing = 4;
    const postsPerSide = CHUNK_LENGTH / postSpacing;
    const buildingsPerSide = 3;

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = new THREE.Group();

      const road = new THREE.Mesh(asphaltGeo, asphaltMat);
      road.receiveShadow = true;
      chunk.add(road);

      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.position.y = -0.03;
      chunk.add(ground);

      const posts = new THREE.InstancedMesh(postGeo, postMat, postsPerSide * 2);
      const m = new THREE.Matrix4();
      let n = 0;
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(side * RAIL_X, 0.62, 0);
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.position.set(side * RAIL_X, 0.82, 0);
        chunk.add(rail, tube);
        for (let p = 0; p < postsPerSide; p++) {
          m.makeTranslation(side * (RAIL_X + 0.08), 0.37, -CHUNK_LENGTH / 2 + p * postSpacing);
          posts.setMatrixAt(n++, m);
        }
      }
      chunk.add(posts);

      // one street lamp per chunk, alternating sides
      const side = i % 2 === 0 ? -1 : 1;
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.5;
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(-side * 1.2, 8.8, 0);
      const head = new THREE.Mesh(lampGeo, lampMat);
      head.position.set(-side * 2.3, 8.7, 0);
      lamp.add(pole, arm, head);
      lamp.position.set(side * (RAIL_X + 1.6), 0, 0);
      chunk.add(lamp);

      // city blocks on both sides with lit windows and neon roof trims
      for (const bSide of [-1, 1]) {
        for (let b = 0; b < buildingsPerSide; b++) {
          const w = 10 + Math.random() * 12;
          const d = 12 + Math.random() * 6;
          const h = 10 + Math.random() * 38;
          const building = new THREE.Mesh(buildingGeo, buildingMat);
          building.scale.set(w, h, d);
          const x = bSide * (RAIL_X + 30 + Math.random() * 55 + w / 2);
          const z = -CHUNK_LENGTH / 2 + (b + 0.5) * (CHUNK_LENGTH / buildingsPerSide);
          building.position.set(x, h / 2, z);
          const roof = new THREE.Mesh(roofGeo, roofMats[Math.floor(Math.random() * roofMats.length)]);
          roof.scale.set(w + 0.3, 1, d + 0.3);
          roof.position.set(x, h, z);
          chunk.add(building, roof);
        }
      }

      chunk.position.z = RECYCLE_Z - CHUNK_LENGTH / 2 - i * CHUNK_LENGTH;
      this.chunks.push(chunk);
      this.group.add(chunk);
    }
  }

  /** Scroll the road towards the camera by dz metres. */
  update(dz: number): void {
    for (const c of this.chunks) {
      c.position.z += dz;
      if (c.position.z - CHUNK_LENGTH / 2 > RECYCLE_Z) c.position.z -= CHUNK_COUNT * CHUNK_LENGTH;
    }
  }
}
