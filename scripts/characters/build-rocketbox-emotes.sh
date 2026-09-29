#!/usr/bin/env bash
# Builds the walkthrough's two shared emote sets (male and female clips, no
# mesh) into <out_dir>/emotes-{male,female}.glb.
#
#   scripts/characters/build-rocketbox-emotes.sh <rocketbox_clone> <anims_dir> <out_dir>
#
# <anims_dir> holds the EMOTES clips listed in build-rocketbox-character.py.
# The clip lengths it prints feed EMOTES in
# packages/editor/src/components/editor/first-person/emotes.ts.
set -euo pipefail

rocketbox=$1
anims=$2
out=$3
here=$(cd "$(dirname "$0")" && pwd)
python=${PYTHON:-python}
gltf=${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for pair in m:male:Male_Adult_01 f:female:Female_Adult_01; do
  IFS=: read -r code gender reference <<<"$pair"
  "$python" "$here/build-rocketbox-character.py" -- emotes \
    "$rocketbox/Assets/Avatars/Adults/$reference/Export/$reference.fbx" "$code" "$anims" \
    "$work/$gender.glb" "$work/$gender.json" | grep '^META'
  $gltf resample "$work/$gender.glb" "$work/$gender.r.glb" >/dev/null
  $gltf meshopt "$work/$gender.r.glb" "$out/emotes-$gender.glb" >/dev/null
done
