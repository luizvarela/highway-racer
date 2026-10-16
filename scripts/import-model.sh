#!/bin/sh
# Shrink a raw Tripo GLB into a game-ready model.
# usage: scripts/import-model.sh assets-src/tripo/comet.glb public/models/hero/comet.glb [ratio]
set -e
in="$1"; out="$2"; ratio="${3:-0.03}"
tmp=$(mktemp -d)
G=node_modules/.bin/gltf-transform
$G weld "$in" "$tmp/a.glb"
$G simplify "$tmp/a.glb" "$tmp/b.glb" --ratio "$ratio" --error 0.0005 # ~2M -> ~60k triangles
node scripts/strip-maps.mjs "$tmp/b.glb"
node scripts/smooth-normals.mjs "$tmp/b.glb" 8
$G resize "$tmp/b.glb" "$tmp/c.glb" --width 2048 --height 2048
$G webp "$tmp/c.glb" "$tmp/d.glb" --quality 85
$G meshopt "$tmp/d.glb" "$out"
rm -rf "$tmp"
ls -la "$out"
