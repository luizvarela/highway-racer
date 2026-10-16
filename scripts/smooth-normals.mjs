// Shade an AI mesh as if its panels were smooth: compute normals on a
// Laplacian-smoothed copy and put them on the real mesh. The outline is
// unchanged; the small lumps and dents no longer catch the light.
// usage: node scripts/smooth-normals.mjs file.glb [iterations]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const [, , file, iterArg] = process.argv;
const iterations = Number(iterArg ?? 6);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION").getArray();
    const idx = prim.getIndices().getArray();
    const n = pos.length / 3;
    // vertices split at UV seams share a position: smooth them as one
    const key = new Map();
    const uid = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
      if (!key.has(k)) key.set(k, key.size);
      uid[i] = key.get(k);
    }
    const u = key.size;
    let p = new Float64Array(u * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) p[uid[i] * 3 + c] = pos[i * 3 + c];
    const nb = Array.from({ length: u }, () => new Set());
    for (let t = 0; t < idx.length; t += 3) {
      const a = uid[idx[t]], b = uid[idx[t + 1]], c = uid[idx[t + 2]];
      nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
    }
    for (let it = 0; it < iterations; it++) {
      for (const lambda of [0.5, -0.53]) { // Taubin: smooth without shrinking
        const q = new Float64Array(p);
        for (let v = 0; v < u; v++) {
          if (!nb[v].size) continue;
          let x = 0, y = 0, z = 0;
          for (const w of nb[v]) { x += p[w * 3]; y += p[w * 3 + 1]; z += p[w * 3 + 2]; }
          const s = nb[v].size;
          q[v * 3] += lambda * (x / s - p[v * 3]);
          q[v * 3 + 1] += lambda * (y / s - p[v * 3 + 1]);
          q[v * 3 + 2] += lambda * (z / s - p[v * 3 + 2]);
        }
        p = q;
      }
    }
    const nrm = new Float64Array(u * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = uid[idx[t]], b = uid[idx[t + 1]], c = uid[idx[t + 2]];
      const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; // area-weighted
      for (const v of [a, b, c]) { nrm[v * 3] += fx; nrm[v * 3 + 1] += fy; nrm[v * 3 + 2] += fz; }
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = uid[i];
      const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = nrm[v * 3 + c] / l;
    }
    prim.getAttribute("NORMAL").setArray(out);
  }
}
await io.write(file, doc);
