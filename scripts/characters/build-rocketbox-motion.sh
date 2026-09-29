#!/usr/bin/env bash
# Builds the walkthrough's two shared motion sets (male and female clips, no
# mesh) into <out_dir>/motion-{male,female}.glb.
#
#   scripts/characters/build-rocketbox-motion.sh <rocketbox_clone> <anims_dir> <cmu_bvh_dir> <out_dir>
#
# <anims_dir> and <cmu_bvh_dir> hold the Rocketbox and CMU clips listed in
# build-rocketbox-character.py. The clip timings it prints feed MOTION_SETS in
# packages/editor/src/components/editor/first-person/locomotion.ts.
set -euo pipefail

rocketbox=$1
anims=$2
cmu=$3
out=$4
here=$(cd "$(dirname "$0")" && pwd)
python=${PYTHON:-python}
gltf=${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for pair in m:male:Male_Adult_01 f:female:Female_Adult_01; do
  IFS=: read -r code gender reference <<<"$pair"
  "$python" "$here/build-rocketbox-character.py" -- anims \
    "$rocketbox/Assets/Avatars/Adults/$reference/Export/$reference.fbx" "$code" "$anims" "$cmu" \
    "$work/$gender.glb" "$work/$gender.json" | grep '^META'
  $gltf resample "$work/$gender.glb" "$work/$gender.r.glb" >/dev/null
  $gltf meshopt "$work/$gender.r.glb" "$out/motion-$gender.glb" >/dev/null
done
