import * as THREE from "three";
import { CHUNK_COUNT, CHUNK_LENGTH, LANE_COUNT, LANE_WIDTH, RAIL_X, RECYCLE_Z, ROAD_WIDTH, SHOULDER } from "./config";

// Endless neon highway made of CHUNK_COUNT chunks. Each frame they scroll
// towards +Z; a chunk that passes behind the camera jumps to the front and is
// dressed for whatever the district sequence says comes next (city or tunnel).

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
  ctx.fillStyle = "#fff"; // tinted per district by the material's emissive colour
  ctx.fillRect(0, 0, s, 3);
  ctx.fillRect(0, 0, 3, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(GROUND_WIDTH / 10, CHUNK_LENGTH / 10);
  t.anisotropy = 8;
  return t;
}

/** Loaded once and shared: AI-painted facade photo plus a map of just its lit windows. */
const textureCache = new Map<string, THREE.Texture>();
function envTexture(name: string): THREE.Texture {
  let t = textureCache.get(name);
  if (!t) {
    t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}env/${name}.webp`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    textureCache.set(name, t);
  }
  return t;
}

export type Facade = "glass" | "apartment" | "warehouse";
const FACADE_TILE: Record<Facade, number> = { glass: 34, apartment: 26, warehouse: 18 }; // metres per image

/**
 * Facade material that tiles at real-world size whatever the box's scale:
 * UVs come from the scaled object-space position (not world space, so the
 * texture doesn't slide as the chunk scrolls).
 */
function facadeMaterial(facade: Facade, tint: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: envTexture(`facade-${facade}`),
    emissiveMap: envTexture(`facade-${facade}-glow`),
    color: 0x9a96a8,
    emissive: tint,
    emissiveIntensity: 1.5,
    roughness: 0.85,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.facadeTile = { value: FACADE_TILE[facade] };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float facadeTile;")
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vec3 fScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        vec3 fp = position * fScale + vec3(0.0, fScale.y * 0.5, 0.0); // y from the ground up
        vec2 fuv = abs(normal.x) > 0.5 ? fp.zy : abs(normal.z) > 0.5 ? fp.xy : fp.xz;
        fuv /= facadeTile;
        vMapUv = fuv;
        vEmissiveMapUv = fuv;`,
      );
  };
  mat.customProgramCacheKey = () => `facade-${facade}`;
  return mat;
}

/** Tunnel wall: concrete panels with a faint joint every 4 m. */
function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = "#3a3a44";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 40 + Math.random() * 30;
    ctx.fillStyle = `rgba(${v},${v},${v + 8},0.35)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  ctx.fillStyle = "#24242c";
  ctx.fillRect(0, 0, 3, 256); // vertical joint
  ctx.fillRect(0, 170, 256, 2); // horizontal joint
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(CHUNK_LENGTH / 4, 2);
  t.anisotropy = 8;
  return t;
}

export type ChunkKind = "city" | "tunnel";

/** City districts: same layout, own colours. A tunnel separates each one. */
export interface District {
  name: string;
  rail: number; // guardrail neon tube
  lamp: number; // street lamp heads
  grid: number; // ground grid
  roofs: number[]; // neon roof trims
  facades: Facade[]; // building fronts to pick from
  glow: number; // tint of the lit windows
}

export const DISTRICTS: District[] = [
  { name: "NEON DOWNTOWN", rail: NEON_PINK, lamp: NEON_CYAN, grid: 0xb21fd0, roofs: [NEON_PINK, NEON_CYAN, 0xffb000], facades: ["glass", "apartment", "glass"], glow: 0xffffff },
  { name: "GOLD UPTOWN", rail: 0xffa21a, lamp: 0xfff0c8, grid: 0x14a6a0, roofs: [0xffc23a, 0x2af0d8, 0xfff0c8], facades: ["glass"], glow: 0xffe2b0 },
  { name: "ULTRAVIOLET", rail: 0x9dff3a, lamp: 0xb36bff, grid: 0x6a2bff, roofs: [0xb36bff, 0x9dff3a, 0xff3a8c], facades: ["apartment", "glass", "apartment"], glow: 0xe0c8ff },
];

/** What the road ahead looks like: city blocks with a tunnel every so often. */
class DistrictSequence {
  private kind: ChunkKind = "city";
  private left = 0;
  private district = 0;
  /** chunk index inside the current stretch */
  index = 0;

  reset(): void {
    this.kind = "city";
    this.district = 0;
    this.left = 3; // the CHUNK_COUNT starting chunks are city too: first tunnel ~800 m in
    this.index = 0;
  }

  next(): { kind: ChunkKind; entrance: boolean; district: number } {
    if (this.left <= 0) {
      this.kind = this.kind === "city" ? "tunnel" : "city";
      if (this.kind === "city") this.district = (this.district + 1) % DISTRICTS.length;
      this.left = this.kind === "tunnel" ? 5 + Math.floor(Math.random() * 4) : 16 + Math.floor(Math.random() * 8);
      this.index = 0;
    }
    this.left--;
    const entrance = this.kind === "tunnel" && this.index === 0;
    this.index++;
    return { kind: this.kind, entrance, district: this.district };
  }
}

interface Chunk {
  group: THREE.Group;
  kind: ChunkKind;
  district: number;
  tubes: THREE.Mesh[];
  lampHead: THREE.Mesh;
  ground: THREE.Mesh;
  city: THREE.Group;
  tunnel: THREE.Group;
  portal: THREE.Group;
  buildings: { body: THREE.Mesh; roof: THREE.Mesh; shop: THREE.Mesh }[];
  billboard: THREE.Group;
  poster: THREE.Mesh;
}

/** Roadside posters (public/env/billboard-*.webp), one in a few city chunks. */
const BILLBOARDS = ["nightfm", "volt"];
const BILLBOARD_CHANCE = 0.4;

export const TUNNEL_HEIGHT = 11.5; // clears the chase camera, which rises to ~9 m
const TUNNEL_X = RAIL_X + 1.4;
const LAMP_SPACING = 10;

export class Road {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly sequence = new DistrictSequence();
  private readonly posterMats: THREE.Material[];
  private readonly shopMats: THREE.Material[];
  private readonly mats: {
    tube: THREE.Material; lamp: THREE.Material; ground: THREE.Material; buildings: THREE.Material[]; roofs: THREE.Material[];
  }[];
  /** metres scrolled since the run started (tunnel lamp rhythm) */
  travelled = 0;

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
    const gridTex = gridTexture();
    this.mats = DISTRICTS.map((d) => ({
      tube: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: d.rail, emissiveIntensity: 3 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: d.lamp, emissiveIntensity: 5 }),
      ground: new THREE.MeshStandardMaterial({ color: 0x07040f, emissive: d.grid, emissiveMap: gridTex, emissiveIntensity: 0.9, roughness: 1 }),
      buildings: d.facades.map((f) => facadeMaterial(f, d.glow)),
      roofs: d.roofs.map((c) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 3 })),
    }));
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.7, roughness: 0.35 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.6 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d1f27, roughness: 0.5, metalness: 0.5 });
    const base = this.mats[0];
    const loader = new THREE.TextureLoader();
    this.posterMats = BILLBOARDS.map((name) => {
      const t = loader.load(`${import.meta.env.BASE_URL}env/billboard-${name}.webp`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return new THREE.MeshBasicMaterial({ map: t, color: 0xd8d8d8 }); // lit from within; a bit under 1 so bloom stays soft
    });
    // street-level shopfronts: half of the strip each, so neighbours differ
    this.shopMats = [0, 0.5].map((offset) => {
      const t = envTexture("shopfront").clone();
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.repeat.x = 0.5;
      t.offset.x = offset;
      return new THREE.MeshBasicMaterial({ map: t, color: 0xc8c8c8 });
    });
    const shopGeo = new THREE.PlaneGeometry(1, 1);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.6, metalness: 0.4 });
    // tunnel
    const wallMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.85 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.9 });
    const sodiumMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 4 });
    const stripMats = [NEON_CYAN, NEON_PINK].map(
      (c) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 3 }),
    );
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0x55555f, roughness: 0.8 });
    // the facade texture tiled at building scale (one tile ~ 10 x 20 m) on the big tunnel block
    const blockMat = facadeMaterial("glass", 0xffffff);
    const portalTex = concreteTexture();
    portalTex.repeat.set(20, 3);
    const portalMat = new THREE.MeshStandardMaterial({ map: portalTex, roughness: 0.85 });
    const chevronMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb000, emissiveIntensity: 4 });

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
    const wallGeo = new THREE.BoxGeometry(0.6, TUNNEL_HEIGHT, CHUNK_LENGTH);
    const ceilingGeo = new THREE.BoxGeometry(TUNNEL_X * 2 + 1.2, 0.6, CHUNK_LENGTH);
    const kerbGeo = new THREE.BoxGeometry(1.1, 0.35, CHUNK_LENGTH);
    const stripGeo = new THREE.BoxGeometry(0.08, 0.12, CHUNK_LENGTH);
    const sodiumGeo = new THREE.BoxGeometry(0.5, 0.12, 1.6);

    const postSpacing = 4;
    const postsPerSide = CHUNK_LENGTH / postSpacing;
    const buildingsPerSide = 3;
    const lampsPerChunk = CHUNK_LENGTH / LAMP_SPACING;

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const group = new THREE.Group();
      const city = new THREE.Group();
      const tunnel = new THREE.Group();
      const portal = new THREE.Group();
      group.add(city, tunnel);
      tunnel.add(portal);

      const road = new THREE.Mesh(asphaltGeo, asphaltMat);
      road.receiveShadow = true;
      group.add(road);

      // ---- city dressing ----
      const ground = new THREE.Mesh(groundGeo, base.ground);
      ground.position.y = -0.03;
      city.add(ground);

      const posts = new THREE.InstancedMesh(postGeo, postMat, postsPerSide * 2);
      const m = new THREE.Matrix4();
      let n = 0;
      const tubes: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(side * RAIL_X, 0.62, 0);
        const tube = new THREE.Mesh(tubeGeo, base.tube);
        tubes.push(tube);
        tube.position.set(side * RAIL_X, 0.82, 0);
        city.add(rail, tube);
        for (let p = 0; p < postsPerSide; p++) {
          m.makeTranslation(side * (RAIL_X + 0.08), 0.37, -CHUNK_LENGTH / 2 + p * postSpacing);
          posts.setMatrixAt(n++, m);
        }
      }
      city.add(posts);

      // one street lamp per chunk, alternating sides
      const side = i % 2 === 0 ? -1 : 1;
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.5;
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(-side * 1.2, 8.8, 0);
      const head = new THREE.Mesh(lampGeo, base.lamp);
      head.position.set(-side * 2.3, 8.7, 0);
      lamp.add(pole, arm, head);
      lamp.position.set(side * (RAIL_X + 1.6), 0, 0);
      city.add(lamp);

      // city blocks on both sides with lit windows and neon roof trims
      const buildings: Chunk["buildings"] = [];
      for (let b = 0; b < buildingsPerSide * 2; b++) {
        const bodyMesh = new THREE.Mesh(buildingGeo, base.buildings[0]);
        const roof = new THREE.Mesh(roofGeo, base.roofs[0]);
        const shop = new THREE.Mesh(shopGeo, this.shopMats[0]);
        city.add(bodyMesh, roof, shop);
        buildings.push({ body: bodyMesh, roof, shop });
      }

      // roadside billboard: poster in a dark frame on two legs
      const billboard = new THREE.Group();
      const bw = 7, bh = 10.4, lift = 3.5;
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), this.posterMats[0]);
      poster.position.y = lift + bh / 2;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.5, bh + 0.5, 0.3), frameMat);
      frame.position.set(0, lift + bh / 2, -0.2);
      billboard.add(poster, frame);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, lift + 1, 0.35), frameMat);
        leg.position.set(s * bw * 0.3, (lift + 1) / 2, -0.3);
        billboard.add(leg);
      }
      city.add(billboard);

      // ---- tunnel dressing ----
      for (const s of [-1, 1]) {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(s * (TUNNEL_X + 0.3), TUNNEL_HEIGHT / 2, 0);
        wall.rotation.y = s > 0 ? Math.PI : 0; // texture reads the same on both sides
        const kerb = new THREE.Mesh(kerbGeo, kerbMat);
        kerb.position.set(s * (TUNNEL_X - 0.55), 0.17, 0);
        const low = new THREE.Mesh(stripGeo, stripMats[0]);
        low.position.set(s * (TUNNEL_X - 0.02), 1.3, 0);
        const high = new THREE.Mesh(stripGeo, stripMats[1]);
        high.position.set(s * (TUNNEL_X - 0.02), 7.6, 0);
        tunnel.add(wall, kerb, low, high);
      }
      const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
      ceiling.position.y = TUNNEL_HEIGHT + 0.3;
      tunnel.add(ceiling);
      const sodium = new THREE.InstancedMesh(sodiumGeo, sodiumMat, lampsPerChunk * 2);
      n = 0;
      for (let l = 0; l < lampsPerChunk; l++) {
        for (const s of [-1, 1]) {
          m.makeTranslation(s * 3.6, TUNNEL_HEIGHT - 0.05, -CHUNK_LENGTH / 2 + (l + 0.5) * LAMP_SPACING);
          sodium.setMatrixAt(n++, m);
        }
      }
      tunnel.add(sodium);
      // the mass the tunnel runs under: a lit megablock
      const block = new THREE.Mesh(buildingGeo, blockMat);
      block.scale.set(170, 26, CHUNK_LENGTH);
      block.position.y = TUNNEL_HEIGHT + 0.6 + 13;
      tunnel.add(block);

      // ---- tunnel entrance (front of the first tunnel chunk) ----
      const faceZ = -CHUNK_LENGTH / 2;
      const faceMat = portalMat;
      for (const s of [-1, 1]) {
        const face = new THREE.Mesh(buildingGeo, faceMat);
        face.scale.set(80, TUNNEL_HEIGHT + 0.6, 3);
        face.position.set(s * (TUNNEL_X + 40), (TUNNEL_HEIGHT + 0.6) / 2, faceZ - 1.5);
        portal.add(face);
      }
      const lintel = new THREE.Mesh(buildingGeo, faceMat);
      lintel.scale.set(TUNNEL_X * 2 + 0.2, 2.2, 3);
      lintel.position.set(0, TUNNEL_HEIGHT + 0.6 - 1.1, faceZ - 1.5);
      portal.add(lintel);
      // neon frame round the mouth and amber chevrons above it
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL_X * 2, 0.6, 0.2), stripMats[1]);
      frameTop.position.set(0, TUNNEL_HEIGHT - 0.6, faceZ - 3.1);
      portal.add(frameTop);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, TUNNEL_HEIGHT - 0.6, 0.2), stripMats[0]);
        post.position.set(s * TUNNEL_X, (TUNNEL_HEIGHT - 0.6) / 2, faceZ - 3.1);
        portal.add(post);
      }
      for (let c = 0; c < 7; c++) {
        const chev = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.15), chevronMat);
        chev.position.set((c - 3) * 2.6, TUNNEL_HEIGHT + 0.3, faceZ - 3.1);
        chev.rotation.z = c % 2 ? 0.5 : -0.5;
        portal.add(chev);
      }

      const chunk: Chunk = { group, kind: "city", district: 0, tubes, lampHead: head, ground, city, tunnel, portal, buildings, billboard, poster };
      this.chunks.push(chunk);
      this.group.add(group);
    }
    this.reset();
  }

  /** Back to the start of a run: all city, tunnel sequence restarted. */
  reset(): void {
    this.sequence.reset();
    this.travelled = 0;
    this.chunks.forEach((c, i) => {
      c.group.position.z = RECYCLE_Z - CHUNK_LENGTH / 2 - i * CHUNK_LENGTH;
      this.dress(c, "city", false, 0);
    });
  }

  private dress(c: Chunk, kind: ChunkKind, entrance: boolean, district: number): void {
    c.kind = kind;
    c.district = district;
    c.city.visible = kind === "city";
    c.tunnel.visible = kind === "tunnel";
    c.portal.visible = entrance;
    if (kind !== "city") return;
    const mats = this.mats[district];
    for (const t of c.tubes) t.material = mats.tube;
    c.billboard.visible = Math.random() < BILLBOARD_CHANCE;
    if (c.billboard.visible) {
      const side = Math.random() < 0.5 ? -1 : 1;
      c.billboard.position.set(side * (RAIL_X + 7), 0, (Math.random() - 0.5) * CHUNK_LENGTH * 0.6);
      c.billboard.rotation.y = -side * 0.35; // turned towards oncoming drivers
      c.poster.material = this.posterMats[Math.floor(Math.random() * this.posterMats.length)];
    }
    c.lampHead.material = mats.lamp;
    c.ground.material = mats.ground;
    // fresh skyline for every city chunk so blocks never visibly repeat
    const per = c.buildings.length / 2;
    c.buildings.forEach(({ body, roof, shop }, b) => {
      const bSide = b < per ? -1 : 1;
      const slot = b % per;
      const w = 10 + Math.random() * 12;
      const d = 12 + Math.random() * 6;
      const h = 10 + Math.random() * 38;
      body.scale.set(w, h, d);
      const x = bSide * (RAIL_X + 30 + Math.random() * 55 + w / 2);
      const z = -CHUNK_LENGTH / 2 + (slot + 0.5) * (CHUNK_LENGTH / per);
      body.position.set(x, h / 2, z);
      body.material = mats.buildings[Math.floor(Math.random() * mats.buildings.length)];
      roof.material = mats.roofs[Math.floor(Math.random() * mats.roofs.length)];
      roof.scale.set(w + 0.3, 1, d + 0.3);
      roof.position.set(x, h, z);
      // shopfront on the side that faces the road (half the strip: ~1.8 : 1)
      const sh = d / 1.79;
      shop.scale.set(d, sh, 1);
      shop.position.set(x - bSide * (w / 2 + 0.05), sh / 2, z);
      shop.rotation.y = bSide < 0 ? Math.PI / 2 : -Math.PI / 2;
      shop.material = this.shopMats[Math.floor(Math.random() * this.shopMats.length)];
    });
  }

  /** Scroll the road towards the camera by dz metres. */
  update(dz: number): void {
    this.travelled += dz;
    for (const c of this.chunks) {
      c.group.position.z += dz;
      if (c.group.position.z - CHUNK_LENGTH / 2 > RECYCLE_Z) {
        c.group.position.z -= CHUNK_COUNT * CHUNK_LENGTH;
        const next = this.sequence.next();
        this.dress(c, next.kind, next.entrance, next.district);
      }
    }
  }

  private chunkAt(z: number): Chunk | undefined {
    return this.chunks.find((c) => Math.abs(z - c.group.position.z) <= CHUNK_LENGTH / 2);
  }

  /** The kind of road at world z (the player drives at z = 0). */
  kindAt(z: number): ChunkKind {
    return this.chunkAt(z)?.kind ?? "city";
  }

  districtIndexAt(z: number): number {
    return this.chunkAt(z)?.district ?? 0;
  }

  /** The district at world z. */
  districtAt(z: number): District {
    return DISTRICTS[this.chunkAt(z)?.district ?? 0];
  }

  /** 0..1 brightness of the tunnel lamp the player is passing under (lamp rhythm). */
  get lampPulse(): number {
    // lamps sit half a spacing into each chunk; chunks start on a 10 m grid
    const t = ((this.travelled + LAMP_SPACING / 2) % LAMP_SPACING) / LAMP_SPACING;
    return 0.5 + 0.5 * Math.cos(t * Math.PI * 2);
  }
}
