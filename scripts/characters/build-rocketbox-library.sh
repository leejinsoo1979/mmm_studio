#!/usr/bin/env bash
# Builds walkthrough bodies for Rocketbox avatars into the editor's public
# characters folder: a compressed GLB (WebP textures, meshopt geometry), a
# thumbnail each, and a meta line in rocketbox-avatars.jsonl beside this script.
#
#   scripts/characters/build-rocketbox-library.sh <rocketbox_clone> <out_dir> [<Group>/<Name> ...]
#
# With no avatars named it builds every Assets/Avatars/<Group>/<Name> in the
# clone. Needs PYTHON (Blender's bpy + Pillow, see build-rocketbox-character.py)
# and GLTF_TRANSFORM (default: npx @gltf-transform/cli). Then
#   python gen-rocketbox-catalog.py rocketbox-avatars.jsonl \
#     packages/editor/src/components/editor/first-person/rocketbox-catalog.ts
# turns the meta lines into the catalog the editor reads.
set -euo pipefail

rocketbox=$1
out=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
python=${PYTHON:-python}
gltf=${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out/thumbs"

if [ $# -eq 0 ]; then
  set -- $(cd "$rocketbox/Assets/Avatars" && ls -d */*/ | sed 's#/$##')
fi

for avatar in "$@"; do
  name=${avatar#*/}
  src="$rocketbox/Assets/Avatars/$avatar"
  echo "== $avatar"
  "$python" "$here/build-rocketbox-character.py" -- avatar \
    "$src/Export/$name.fbx" "$src/Textures" "$work/$name.glb" "$work/$name.json" >"$work/$name.log" 2>&1 ||
    { tail -20 "$work/$name.log"; exit 1; }
  # The face keeps 2K color; normals and roughness can be coarser.
  $gltf resize "$work/$name.glb" "$work/$name.a.glb" --width 1024 --height 1024 --pattern "*_normal*" >/dev/null
  $gltf resize "$work/$name.a.glb" "$work/$name.b.glb" --width 512 --height 512 --pattern "*roughness*" >/dev/null
  $gltf webp "$work/$name.b.glb" "$work/$name.c.glb" --quality 85 >/dev/null
  $gltf meshopt "$work/$name.c.glb" "$out/$name.glb" >/dev/null
  "$python" - "$src/$name.png" "$out/thumbs/$name.webp" <<'PY'
import sys
from PIL import Image
src, dst = sys.argv[1:]
im = Image.open(src).convert('RGBA')
bg = Image.new('RGBA', im.size, (255, 255, 255, 0))
bg.alpha_composite(im)
x0, y0, x1, y1 = bg.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
cx, h = (x0 + x1) // 2, y1 - y0
w = int(h * 0.62)
bg.crop((cx - w // 2, y0 - 8, cx + w // 2, y1 + 8)).resize((128, 208), Image.LANCZOS).save(dst, quality=82)
PY
  "$python" - "$avatar" "$work/$name.json" "$out/$name.glb" >>"$here/rocketbox-avatars.jsonl" <<'PY'
import json, os, sys
avatar, meta_path, glb = sys.argv[1:]
meta = json.load(open(meta_path))
group, name = avatar.split('/')
print(json.dumps({'id': name, 'group': group, 'hip': meta['hip'], 'height': meta['height'],
                  'triangles': meta['triangles'], 'bytes': os.path.getsize(glb)}))
PY
  rm -f "$work/$name".*
done
