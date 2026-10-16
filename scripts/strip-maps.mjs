// Drop the normal and metal/roughness maps from a Tripo GLB: on AI meshes they
// turn small lumps into visible dents. The game sets an even paint gloss instead.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
const [, , file] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
for (const m of doc.getRoot().listMaterials()) {
  m.setNormalTexture(null).setMetallicRoughnessTexture(null);
  m.setMetallicFactor(0.3).setRoughnessFactor(0.35);
}
await doc.transform(prune());
await io.write(file, doc);
