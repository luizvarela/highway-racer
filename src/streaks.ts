import * as THREE from "three";

// Fake wet-road reflections: soft additive streaks laid on the asphalt under
// lights, stretched towards the camera like real reflections on a wet road.

let texture: THREE.CanvasTexture | null = null;

/** Soft ellipse, brightest near one end; v runs along the streak. */
function streakTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = y / 255;
    const along = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), 1.5) * (1 - v * 0.55);
    for (let x = 0; x < 64; x++) {
      const u = (x - 31.5) / 32;
      const a = Math.max(0, along * Math.exp(-u * u * 5));
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  texture = new THREE.CanvasTexture(c);
  return texture;
}

export function streakMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: streakTexture(),
    color,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Flat streak geometry, `width` across and `length` along +Z (towards the camera), starting at z = 0. */
export function streakGeometry(width: number, length: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2).translate(0, 0, length / 2);
}
