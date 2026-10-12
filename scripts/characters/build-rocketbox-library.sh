#!/usr/bin/env bash
# Builds walkthrough bodies for Rocketbox avatars into the editor's public
# characters folder: a compressed GLB (WebP textures, meshopt geometry), a
# thumbnail each, and a meta line in rocketbox-avatars.jsonl beside this script.
#
#   scripts/characters/build-rocketbox-library.sh <rocketbox_clone> <out_dir> [<Group>/<Name> ...]
#
# With no avatars named it builds every Assets/Avatars/<Group>/<Name> in the
# clone. Needs PYTHON (Blender's bpy + Pillow, see build-rocketbox-character.py)
# and GLTF_TRANSFORM (default: npx @gltf-transform/cli, the version the library
# was built with). Then
#   python gen-rocketbox-catalog.py rocketbox-avatars.jsonl \
#     packages/editor/src/components/editor/first-person/rocketbox-catalog.ts
# turns the meta lines into the catalog the editor reads.
#
# The library in the repo is not one fresh run of this: its GLBs are the ones
# built before the skin mask, with only their head normal and roughness images
# replaced by this build's (swap-glb-images.py, 'head_normal|roughness'), so
# their geometry, and face-points.json read off it, stayed as they were. A
# fresh run re-encodes every texture and the geometry.
set -euo pipefail

rocketbox=$1
out=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
python=${PYTHON:-python}
gltf=${GLTF_TRANSFORM:-npx --yes @gltf-transform/cli@4.5.1}
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
  # Each texture comes at its size (TEX_SIZE, ROUGH_SIZE in build-rocketbox-character.py).
  $gltf webp "$work/$name.glb" "$work/$name.c.glb" --quality 85 >/dev/null
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
  "$python" - "$avatar" "$work/$name.json" "$out/$name.glb" "$here/rocketbox-avatars.jsonl" <<'PY'
import fcntl, json, os, sys
avatar, meta_path, glb, lines_path = sys.argv[1:]
meta = json.load(open(meta_path))
group, name = avatar.split('/')
line = json.dumps({'id': name, 'group': group, 'hip': meta['hip'], 'height': meta['height'],
                   'triangles': meta['triangles'], 'bytes': os.path.getsize(glb)}) + '\n'
# A rebuilt avatar's line takes the place of its old one; runs side by side
# take turns at the file.
with open(lines_path, 'a+') as file:
    fcntl.flock(file, fcntl.LOCK_EX)
    file.seek(0)
    lines = file.readlines()
    rows = [json.loads(old) if old.strip() else None for old in lines]
    at = next((i for i, row in enumerate(rows) if row and (row['id'], row['group']) == (name, group)), None)
    if at is None:
        lines.append(line)
    else:
        lines[at] = line
    file.seek(0)
    file.truncate()
    file.writelines(lines)
PY
  rm -f "$work/$name".*
done
