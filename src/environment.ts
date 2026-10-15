import * as THREE from "three";

// Night backdrop and speed effects. None of this takes part in gameplay.

/** Gradient sky, striped synthwave sun and a city skyline on one far billboard. */
export class Skyline {
  readonly mesh: THREE.Mesh;

  constructor() {
    const w = 2048;
    const h = 640;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#05030d");
    sky.addColorStop(0.55, "#1d0b3a");
    sky.addColorStop(0.85, "#5a1460");
    sky.addColorStop(1, "#8a1d6b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
      ctx.fillRect(Math.random() * w, Math.random() * h * 0.5, 1.5, 1.5);
    }

    // sun with horizontal cut-outs
    const cx = w / 2;
    const cy = h * 0.74;
    const r = 170;
    const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    sun.addColorStop(0, "#ffe66b");
    sun.addColorStop(0.5, "#ff8a3d");
    sun.addColorStop(1, "#ff2bd6");
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = sun;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = cy + 10 + i * 22;
      ctx.fillRect(cx - r, y, r * 2, 4 + i * 1.6);
    }
    ctx.restore();

    // two layers of skyline silhouettes with a few lit windows
    const layer = (base: number, maxH: number, color: string, lit: number) => {
      let x = 0;
      while (x < w) {
        const bw = 30 + Math.random() * 70;
        const bh = 30 + Math.random() * maxH;
        ctx.fillStyle = color;
        ctx.fillRect(x, base - bh, bw, bh);
        for (let i = 0; i < (bw * bh) / 400; i++) {
          if (Math.random() < lit) {
            ctx.fillStyle = Math.random() < 0.5 ? "#ffcf7a" : "#7ff6ff";
            ctx.fillRect(x + 4 + Math.random() * (bw - 8), base - bh + 6 + Math.random() * (bh - 10), 2, 3);
          }
        }
        x += bw + Math.random() * 6;
      }
    };
    layer(h, 210, "#140a26", 0.25);
    layer(h, 120, "#0a0614", 0.45);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 812),
      new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false }),
    );
    this.mesh.position.set(0, 330, -720);
    this.mesh.renderOrder = -1;
  }

  follow(cameraX: number): void {
    this.mesh.position.x = cameraX;
  }
}

/** Streaks that fly past the camera; fade in with speed. */
export class SpeedLines {
  readonly object: THREE.LineSegments;
  private readonly count = 140;
  private readonly positions: Float32Array;
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    this.positions = new Float32Array(this.count * 6);
    for (let i = 0; i < this.count; i++) this.respawn(i, -Math.random() * 140);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({
      color: 0x9ff8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geo, this.material);
    this.object.frustumCulled = false;
  }

  private respawn(i: number, z: number): void {
    const p = this.positions;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (3 + Math.random() * 22);
    const y = 0.3 + Math.random() * 9;
    p.set([x, y, z, x, y, z], i * 6);
  }

  /** speedT: 0..1 normalised speed, metres scrolled this frame. */
  update(speedT: number, dz: number, playerX: number): void {
    const p = this.positions;
    const streak = 2 + speedT * 14;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const z = p[o + 2] + dz * 1.4;
      if (z > 12) {
        this.respawn(i, -130 + Math.random() * 10);
        p[o] += playerX;
        p[o + 3] = p[o];
        continue;
      }
      p[o + 2] = z;
      p[o + 5] = z - streak;
    }
    (this.object.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    const t = THREE.MathUtils.clamp((speedT - 0.45) / 0.55, 0, 1);
    this.material.opacity = t * t * 0.7;
  }
}
