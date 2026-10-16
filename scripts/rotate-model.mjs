// Turn a model about the vertical axis so it faces +Z like the rest.
// usage: node scripts/rotate-model.mjs file.glb degrees
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const [, , file, deg] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const a = (Number(deg) * Math.PI) / 180;
for (const scene of doc.getRoot().listScenes()) {
  for (const node of scene.listChildren()) node.setRotation([0, Math.sin(a / 2), 0, Math.cos(a / 2)]);
}
await io.write(file, doc);
