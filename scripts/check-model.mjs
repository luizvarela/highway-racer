// Warn when a model is longer across (X) than along (Z): it would drive sideways.
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
const [, , file] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(file);
const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
const x = max[0] - min[0], z = max[2] - min[2];
if (x > z) console.error(`WARNING ${file}: ${x.toFixed(2)} wide x ${z.toFixed(2)} long - it lies sideways; re-run with a yaw of 90 (then check which end is the front)`);
