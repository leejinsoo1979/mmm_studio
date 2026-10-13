"""Builds the two MakeHuman base bodies (실사 기본형 남/여) that faces are
fitted onto: an adult male and female from MakeHuman's CC0 base mesh,
targets and system assets, rigged with Mixamo-style bone names, with real
eye meshes (sclera, iris and a separate cornea), brows, lashes, teeth,
tongue, short hair, an outfit, blink shapes, and the head given its own
UV layout and textures so a photo can be painted onto it.

Run it with Blender as a Python module (`pip install bpy`, which brings
numpy; Pillow beside it), from any folder:

  BLENDER_USER_RESOURCES=<an empty folder> python build-mpfb-base.py \
      --mpfb <mpfb2 clone>/src/mpfb --assets <makehuman data> --out <folder>

  --mpfb    https://github.com/makehumancommunity/mpfb2 (git clone; built
            against v2.0.18, d0a32e57).
  --assets  MakeHuman 1.1.1's system assets: Ubuntu's
            makehuman-data_1.1.1-1_all.deb (archive.ubuntu.com, pool
            universe/m/makehuman, sha256 881a79c3a664…f4304a7), unpacked
            with `ar x` and `tar -xJf data.tar.xz`, then
            usr/share/makehuman/data.

It writes, per gender, `mpfb-base-<gender>.raw.glb` (textures at their
final sizes, no compression), `mpfb-base-<gender>.json` (how the face
fitting drives it: head UV layout, morphs, bones, the vertex attributes
below) and `mpfb-base-<gender>.basemesh.bin` (every base mesh vertex at
rest), and once `mpfb-face-targets.bin` + `.json` (MakeHuman's face
targets, compact). Then each GLB is packed as the other 실사 characters are:

  node scripts/characters/build-photoreal-character.mjs \
      <out>/mpfb-base-male.raw.glb apps/editor/public/characters/photoreal/mpfb-base-male.glb

The GLB keeps three vertex attributes the fitting needs: `_MHVERT` on the
body (its MakeHuman base mesh vertex), and `_MHREF`/`_MHW` on every other
mesh (the three base mesh vertices and weights it is bound to, as
MakeHuman's proxies are), so a reshaped face carries its eyes, brows,
lashes, teeth and hair along: move the base mesh by the face targets, the
body by `_MHVERT` and the rest by their bindings.
"""

import argparse
import gzip
import json
import os
import shutil
import sys

import bpy  # first: addon_utils and bmesh only exist once bpy is imported
import addon_utils
import bmesh
import numpy as np
from PIL import Image, ImageFilter

# MakeHuman's macro sliders (0..1) and the parts each body wears.
CHARACTERS = {
    'male': {
        'macro': {'gender': 1.0, 'age': 0.5, 'muscle': 0.6, 'weight': 0.5, 'height': 0.55,
                  'proportions': 0.75, 'cupsize': 0.5, 'firmness': 0.5},
        'race': {'asian': 0.6, 'caucasian': 0.3, 'african': 0.1},
        'skin': 'skins/textures/young_lightskinned_male_diffuse3.png',
        'eyes': 'brown',
        'proxies': [('eyebrows', 'eyebrow001'), ('eyelashes', 'eyelashes01'), ('hair', 'short02'),
                    ('clothes', 'male_casualsuit01'), ('clothes', 'shoes01')],
    },
    'female': {
        'macro': {'gender': 0.0, 'age': 0.5, 'muscle': 0.5, 'weight': 0.45, 'height': 0.5,
                  'proportions': 0.75, 'cupsize': 0.5, 'firmness': 0.6},
        'race': {'asian': 0.6, 'caucasian': 0.3, 'african': 0.1},
        'skin': 'skins/textures/young_lightskinned_female_diffuse3.png',
        'eyes': 'brown',
        'proxies': [('eyebrows', 'eyebrow006'), ('eyelashes', 'eyelashes02'), ('hair', 'ponytail01'),
                    ('clothes', 'female_casualsuit01'), ('clothes', 'shoes02')],
        # The ponytail's light brown, darkened to a dark brown.
        'hair_tint': (0.5, 0.42, 0.38),
    },
}
# Worn by both: the eyes, teeth and tongue.
COMMON_PROXIES = [('eyes', 'high-poly'), ('teeth', 'teeth_base'), ('tongue', 'tongue01')]
ASSET_TYPES = {'eyes': 'Eyes', 'eyebrows': 'Eyebrows', 'eyelashes': 'Eyelashes', 'teeth': 'Teeth',
               'tongue': 'Tongue', 'hair': 'Hair', 'clothes': 'Clothes'}

# Each part's mesh and material names (human-shading.ts tells surfaces by them).
MESH_NAMES = {'eyes': 'Eyes', 'eyebrows': 'Eyebrows', 'eyelashes': 'Eyelashes', 'teeth': 'Teeth',
              'tongue': 'Tongue', 'hair': 'Hair'}

# MakeHuman's base mesh: its first 13380 vertices are the body, the rest helpers.
BODY_VERTICES = 13380
# The head's texture and how much of it each island takes (see head_layout).
HEAD_SIZE = 2048
BODY_SIZE = 1024
HEAD_ROUGHNESS_SIZE = 1024
# Atlas UV boxes of the head's islands in MakeHuman's layout (u0, v0, u1, v1).
HEAD_ISLANDS = {
    'head': (0.63, 0.14, 1.0, 0.83),
    'mouth': (0.75, 0.0, 0.93, 0.14),
    'sockets': (0.0, 0.54, 0.16, 0.64),
}
# Where each island goes in the head texture: the face (MPFB's face_solid
# layout, a front view of it) top left and largest, the rest of the head
# (sides, ears, scalp, back: MakeHuman's atlas island) turned a quarter
# along the bottom, the inside of the mouth and the eye sockets on the right.
FACE_BOX = (0.0, 0.36, 0.70, 1.0)
REST_BOX = (0.0, 0.0, 0.84, 0.355)
MOUTH_BOX = (0.72, 0.62, 1.0, 0.86)
SOCKETS_BOX = (0.72, 0.38, 1.0, 0.60)
PADDING = 12
# How far (m) out along the skin's normal cloth may stand over skin it
# hides, and how far in tight cloth may sit.
CLOTH_REACH = 0.06
CLOTH_SINK = 0.02

# Expression units (MakeHuman's, per race) that close each eye.
BLINKS = {'eyeBlinkLeft': 'eye-left-closure', 'eyeBlinkRight': 'eye-right-closure'}
# The face target groups exported for fitting.
FACE_TARGET_GROUPS = ['head', 'forehead', 'eyebrows', 'eyes', 'nose', 'mouth', 'cheek', 'chin', 'ears', 'neck']
# Face target deltas are stored as int16 steps of this many metres.
TARGET_STEP = 1e-5


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--mpfb', required=True)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--only', choices=sorted(CHARACTERS))
    return parser.parse_args(argv)


ARGS = parse_args()
WORK = os.path.join(ARGS.out, 'work')


def enable_mpfb():
    resources = os.environ.get('BLENDER_USER_RESOURCES')
    if not resources:
        sys.exit('set BLENDER_USER_RESOURCES to an empty folder (MPFB is installed there as an extension)')
    extensions = os.path.join(resources, 'extensions', 'user_default')
    os.makedirs(extensions, exist_ok=True)
    link = os.path.join(extensions, 'mpfb')
    if not os.path.exists(link):
        os.symlink(os.path.abspath(ARGS.mpfb), link)
    addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)


enable_mpfb()
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

MPFB_DATA = os.path.join(ARGS.mpfb, 'data')


# ---------------------------------------------------------------- assets


def prepare_asset(kind, name):
    """A copy of a system asset's folder with its mesh as OBJ (the package
    ships it compiled to .npz, which MakeHuman reads in its place)."""
    source = os.path.join(ARGS.assets, kind, name)
    target = os.path.join(WORK, 'assets', kind, name)
    if os.path.exists(target):
        shutil.rmtree(target)
    shutil.copytree(source, target)
    mhclo = next(f for f in os.listdir(target) if f.endswith('.mhclo'))
    obj_name = next(line.split()[1] for line in open(os.path.join(target, mhclo)) if line.startswith('obj_file'))
    npz = np.load(os.path.join(target, next(f for f in os.listdir(target) if f.endswith('.npz'))))
    with open(os.path.join(target, obj_name), 'w') as obj:
        for v in npz['coord']:
            obj.write('v %.6f %.6f %.6f\n' % tuple(v))
        for t in npz['texco']:
            obj.write('vt %.6f %.6f\n' % tuple(t))
        for verts, uvs in zip(npz['fvert'], npz['fuvs']):
            obj.write('f ' + ' '.join(f'{a + 1}/{b + 1}' for a, b in zip(verts, uvs)) + '\n')
    return os.path.join(target, mhclo)


def mhmat_textures(mhclo_path):
    """A proxy's material textures (diffuse, normal, ao) by kind, as full paths."""
    folder = os.path.dirname(mhclo_path)
    material = next(line.split()[1] for line in open(mhclo_path) if line.startswith('material'))
    material = os.path.normpath(os.path.join(folder, material))
    if not os.path.exists(material):
        # The package keeps eye and teeth materials in a sibling folder.
        material = os.path.join(ARGS.assets, os.path.relpath(material, os.path.join(WORK, 'assets')))
    textures = {}
    for line in open(material):
        words = line.split()
        if len(words) == 2 and words[0] in ('diffuseTexture', 'normalmapTexture', 'aomapTexture'):
            textures[words[0][:-7]] = os.path.normpath(os.path.join(os.path.dirname(material), words[1]))
    return textures


def load_image(path, mode='RGB'):
    return Image.open(path).convert(mode)


# ---------------------------------------------------------------- texture transfer


def sample(image, u, v):
    """Bilinear samples of a float image (H, W, C) at UVs (v up)."""
    h, w = image.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1)
    y = np.clip((1 - v) * h - 0.5, 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = image[y0, x0] * (1 - fx) + image[y0, x1] * fx
    bottom = image[y1, x0] * (1 - fx) + image[y1, x1] * fx
    return top * (1 - fy) + bottom * fy


def transfer(triangles, sources, size):
    """Each source image redrawn in a new UV layout: `triangles` (N, 3, 4)
    holds per corner the new UV then the source UV; returns the images
    (size², float) and the mask of texels covered."""
    outs = [np.zeros((size, size, s.shape[2]), np.float32) for s in sources]
    mask = np.zeros((size, size), bool)
    for tri in triangles:
        dst = tri[:, :2] * size
        dst[:, 1] = size - dst[:, 1]
        x0, y0 = np.floor(dst.min(0)).astype(int)
        x1, y1 = np.ceil(dst.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        a, b, c = dst
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        w2 = 1 - w0 - w1
        # A little past the edges, so neighbouring triangles leave no gaps.
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any():
            continue
        su = w0[inside] * tri[0, 2] + w1[inside] * tri[1, 2] + w2[inside] * tri[2, 2]
        sv = w0[inside] * tri[0, 3] + w1[inside] * tri[1, 3] + w2[inside] * tri[2, 3]
        py = (ys[inside] - 0.5).astype(int)
        px = (xs[inside] - 0.5).astype(int)
        for out, source in zip(outs, sources):
            out[py, px] = sample(source, su, sv)
        mask[py, px] = True
    return outs, mask


def dilate(image, mask, steps):
    """Colours spread out of the mask's edges by `steps` texels (seams stay clean when mipmapped)."""
    image = image.copy()
    mask = mask.copy()
    for _ in range(steps):
        total = np.zeros_like(image)
        count = np.zeros(mask.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.roll(np.roll(mask, dy, 0), dx, 1)
                total += np.roll(np.roll(image * mask[..., None], dy, 0), dx, 1)
                count += shifted
        grow = (~mask) & (count > 0)
        image[grow] = total[grow] / count[grow][:, None]
        mask = mask | grow
    return image, mask


def fill_rest(image, mask, colour):
    image = image.copy()
    image[~mask] = colour
    return image


def save(array, path, mode):
    Image.fromarray(np.clip(array * 255 + 0.5, 0, 255).astype(np.uint8), mode).save(path)
    return path


# ---------------------------------------------------------------- mesh helpers


def components(mesh):
    """Each vertex's connected component (by edges)."""
    parent = np.arange(len(mesh.vertices))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for edge in mesh.edges:
        a, b = find(edge.vertices[0]), find(edge.vertices[1])
        if a != b:
            parent[b] = a
    return np.array([find(i) for i in range(len(mesh.vertices))])


def coordinates(obj):
    co = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def world_coordinates(obj):
    co = coordinates(obj)
    matrix = np.array(obj.matrix_world)
    return co @ matrix[:3, :3].T + matrix[:3, 3]


def add_shape_key(obj, name, deltas):
    if obj.data.shape_keys is None:
        obj.shape_key_add(name='Basis', from_mix=False)
    key = obj.shape_key_add(name=name, from_mix=False)
    key.value = 0.0
    base = coordinates(obj)
    key.data.foreach_set('co', (base + deltas).ravel())
    return key


def set_point_attribute(obj, name, values):
    values = np.asarray(values, np.float32)
    kind = 'FLOAT' if values.ndim == 1 else 'FLOAT_VECTOR'
    attribute = obj.data.attributes.new(name=name, type=kind, domain='POINT')
    attribute.data.foreach_set('value' if kind == 'FLOAT' else 'vector', values.ravel())


def cloth_trees(clothes):
    """Ray-cast trees of the clothes, in world space."""
    from mathutils.bvhtree import BVHTree

    depsgraph = bpy.context.evaluated_depsgraph_get()
    return [(BVHTree.FromObject(obj, depsgraph), obj.matrix_world.inverted()) for obj in clothes]


def under_cloth(body, index, trees):
    """Whether the clothes pass over a body vertex: a ray out along its
    normal meets them within CLOTH_REACH, or one in meets them within
    CLOTH_SINK (tight cloth sits a little inside the skin)."""
    vertex = body.data.vertices[index]
    origin = body.matrix_world @ vertex.co
    normal = (body.matrix_world.to_3x3() @ vertex.normal).normalized()
    for bvh, inverse in trees:
        start = inverse @ origin
        out = (inverse.to_3x3() @ normal).normalized()
        if bvh.ray_cast(start - out * CLOTH_SINK, out, CLOTH_REACH + CLOTH_SINK)[0] is not None:
            return True
    return False


def delete_vertices(obj, indices):
    """Deletes vertices (and their faces), keeping shape keys and attributes."""
    if len(indices) == 0:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in indices], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# ---------------------------------------------------------------- materials


def image_node(nodes, path, colour=True):
    node = nodes.new('ShaderNodeTexImage')
    node.image = bpy.data.images.load(path, check_existing=True)
    node.image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return node


def material(name, *, color=None, normal=None, rough=None, alpha=None, cutoff=0.5, roughness=0.6,
             double_sided=False):
    """A glTF-shaped material: base colour (and its alpha: None opaque, 'blend' or 'mask'),
    tangent-space normal, metallic-roughness (G roughness, B metal; R left for the skin mask)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    if color:
        tex = image_node(nodes, color)
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha == 'blend':
            links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        elif alpha == 'mask':
            less = nodes.new('ShaderNodeMath')
            less.operation = 'LESS_THAN'
            less.inputs[1].default_value = cutoff
            one_minus = nodes.new('ShaderNodeMath')
            one_minus.operation = 'SUBTRACT'
            one_minus.inputs[0].default_value = 1.0
            links.new(tex.outputs['Alpha'], less.inputs[0])
            links.new(less.outputs[0], one_minus.inputs[1])
            links.new(one_minus.outputs[0], bsdf.inputs['Alpha'])
    if normal:
        tex = image_node(nodes, normal, colour=False)
        node = nodes.new('ShaderNodeNormalMap')
        links.new(tex.outputs['Color'], node.inputs['Color'])
        links.new(node.outputs['Normal'], bsdf.inputs['Normal'])
    if rough:
        tex = image_node(nodes, rough, colour=False)
        split = nodes.new('ShaderNodeSeparateColor')
        links.new(tex.outputs['Color'], split.inputs['Color'])
        links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
        links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    if alpha == 'blend':
        mat.surface_render_method = 'BLENDED'
    return mat


# ---------------------------------------------------------------- head layout


def box_transform(src_box, dst_box, rotate=False):
    """The map from a UV box onto another, uniformly scaled and centred (a
    quarter turn first when `rotate`): uv' = A uv + t."""
    su, sv = src_box[2] - src_box[0], src_box[3] - src_box[1]
    if rotate:
        su, sv = sv, su
    du, dv = dst_box[2] - dst_box[0], dst_box[3] - dst_box[1]
    scale = min(du / su, dv / sv)
    if rotate:
        # (u, v) -> (v, -u): the atlas island's left (the top of the head) turns up.
        a = np.array([[0.0, 1.0], [-1.0, 0.0]]) * scale
        corner = np.array([src_box[1], -src_box[2]]) * scale
    else:
        a = np.eye(2) * scale
        corner = np.array([src_box[0], src_box[1]]) * scale
    offset = np.array([dst_box[0] + (du - su * scale) / 2, dst_box[1] + (dv - sv * scale) / 2])
    return a, offset - corner, scale


def head_layout(mesh, atlas_uv):
    """Which faces are the head's, and their UVs in the head texture: the
    face from MPFB's face_solid layout, every other head island from the
    atlas, each boxed as above. Returns the head face set, per loop new UVs
    (for head loops), and the transforms (for the fitting's notes)."""
    face_solid = json.load(gzip.open(os.path.join(MPFB_DATA, 'uv_layers', 'face_solid.json.gz'), 'rt'))
    face_uv = {int(face): {int(loop): uv for loop, uv in loops.items()} for face, loops in face_solid.items()}
    island_of = {}
    for poly in mesh.polygons:
        if max(poly.vertices) >= BODY_VERTICES:
            continue
        u, v = atlas_uv[list(poly.loop_indices)].mean(0)
        for name, (u0, v0, u1, v1) in HEAD_ISLANDS.items():
            if u0 <= u <= u1 and v0 <= v <= v1:
                island_of[poly.index] = name
    for face in face_uv:
        assert island_of.get(face) == 'head', 'face_solid face outside the head island'
    all_face_uv = np.array([uv for loops in face_uv.values() for uv in loops.values()])
    face_src = (*all_face_uv.min(0), *all_face_uv.max(0))
    boxes = {}
    for name in HEAD_ISLANDS:
        uvs = np.concatenate([atlas_uv[list(mesh.polygons[f].loop_indices)] for f, n in island_of.items() if n == name])
        boxes[name] = (*uvs.min(0), *uvs.max(0))
    transforms = {
        'face': box_transform(face_src, FACE_BOX),
        'head': box_transform(boxes['head'], REST_BOX, rotate=True),
        'mouth': box_transform(boxes['mouth'], MOUTH_BOX),
        'sockets': box_transform(boxes['sockets'], SOCKETS_BOX),
    }
    new_uv = {}
    for face, island in island_of.items():
        poly = mesh.polygons[face]
        for loop in poly.loop_indices:
            if face in face_uv:
                a, t, _ = transforms['face']
                uv = np.array(face_uv[face][loop])
            else:
                a, t, _ = transforms[island]
                uv = atlas_uv[loop]
            new_uv[loop] = a @ uv + t
    notes = {
        name: {
            'source': ('MPFB data/uv_layers/face_solid.json.gz' if name == 'face' else 'MakeHuman atlas UV (the body texture\'s layout)'),
            'sourceBox': [round(float(x), 6) for x in (face_src if name == 'face' else boxes[name])],
            'matrix': [[round(float(x), 6) for x in row] for row in transforms[name][0]],
            'offset': [round(float(x), 6) for x in transforms[name][1]],
        }
        for name in transforms
    }
    return set(island_of), new_uv, notes


# ---------------------------------------------------------------- build


def blink_deltas(human, race):
    """The eyes' closure targets, mixed by race as MakeHuman mixes them, as shape key deltas."""
    deltas = {}
    base = coordinates(human)
    for key, unit in BLINKS.items():
        total = np.zeros_like(base)
        for name, weight in race.items():
            if weight <= 0:
                continue
            path = os.path.join(MPFB_DATA, 'targets', 'expression', 'units', name, unit + '.target.gz')
            shape = TargetService.load_target(human, path, weight=0.0, name='tmp-' + name)
            co = np.zeros(len(shape.data) * 3)
            shape.data.foreach_get('co', co)
            total += weight * (co.reshape(-1, 3) - base)
            human.shape_key_remove(shape)
        deltas[key] = total
    human.shape_key_clear()
    return deltas


def proxy_binding(mhclo_path):
    """A proxy's per-vertex base mesh vertices and weights (MakeHuman's mhclo binding)."""
    mhclo = Mhclo()
    mhclo.load(mhclo_path)
    refs = np.array([mhclo.verts[i]['verts'] for i in range(len(mhclo.verts))], np.float32)
    weights = np.array([mhclo.verts[i]['weights'] for i in range(len(mhclo.verts))], np.float32)
    return refs, weights


def add_eye_bones(rig, eyes):
    """LeftEye/RightEye under the head at each eyeball's centre, pointing
    forward, and the eye mesh bound to them alone."""
    co = coordinates(eyes)
    comp = components(eyes.data)
    centres = {}
    for side, sign in (('Left', 1), ('Right', -1)):
        on_side = co[:, 0] * sign > 0
        # The eyeball is the smaller of the side's two shells (the cornea wraps it).
        shells = [c for c in np.unique(comp[on_side])]
        sizes = {c: np.ptp(co[comp == c], axis=0).max() for c in shells}
        ball = min(sizes, key=sizes.get)
        centres[side] = co[comp == ball].mean(0)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    head = rig.data.edit_bones['mixamorig:Head']
    for side, centre in centres.items():
        bone = rig.data.edit_bones.new(f'mixamorig:{side}Eye')
        bone.head = tuple(centre)
        bone.tail = tuple(centre + np.array([0.0, -0.025, 0.0]))
        bone.roll = 0
        bone.parent = head
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    for group in list(eyes.vertex_groups):
        eyes.vertex_groups.remove(group)
    for side, sign in (('Left', 1), ('Right', -1)):
        group = eyes.vertex_groups.new(name=f'mixamorig:{side}Eye')
        group.add([int(i) for i in np.nonzero(co[:, 0] * sign > 0)[0]], 1.0, 'REPLACE')
    return {side: [round(float(x), 5) for x in c] for side, c in centres.items()}


# The eye texture's two eye pictures (lower left, upper right): each iris's centre and radius.
IRIS_CENTRES = (np.array([0.2985, 0.2945]), np.array([0.70, 0.695]))
IRIS_RADIUS = 0.115
# MakeHuman's brown iris is nearly red; it is turned to a dark brown, its pattern kept.
IRIS_TINT = (0.30, 0.17, 0.085)


def split_eyes(eyes, texture):
    """The eye mesh's materials: the cornea (outer shell) clear, the iris and sclera from the texture."""
    co = coordinates(eyes)
    comp = components(eyes.data)
    cornea = set()
    for sign in (1, -1):
        on_side = co[:, 0] * sign > 0
        shells = np.unique(comp[on_side])
        sizes = {c: np.ptp(co[comp == c], axis=0).max() for c in shells}
        cornea.add(max(sizes, key=sizes.get))
    uv = np.zeros(len(eyes.data.loops) * 2)
    eyes.data.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    eyes.data.materials.clear()
    for mat in (material('Eye_Sclera', color=texture, roughness=0.1),
                material('Eye_Iris', color=texture, roughness=0.5),
                cornea_material()):
        eyes.data.materials.append(mat)
    for poly in eyes.data.polygons:
        if comp[poly.vertices[0]] in cornea:
            poly.material_index = 2
            continue
        # Each eyeball's iris is a disc about its picture's centre in the texture.
        centre = uv[list(poly.loop_indices)].mean(0)
        picture = IRIS_CENTRES[0] if centre[0] < 0.5 else IRIS_CENTRES[1]
        poly.material_index = 1 if np.hypot(*(centre - picture)) < IRIS_RADIUS else 0


def eye_colour(source, out_dir):
    """The eye texture with each iris tinted IRIS_TINT (luminance kept), fading out at its rim."""
    image = np.asarray(load_image(source, 'RGB'), np.float32) / 255
    h, w = image.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    u, v = (xx + 0.5) / w, 1 - (yy + 0.5) / h
    lum = image @ np.array([0.299, 0.587, 0.114], np.float32)
    tint = np.array(IRIS_TINT, np.float32)
    tinted = (lum / (tint @ np.array([0.299, 0.587, 0.114], np.float32)))[..., None] * tint
    for cu, cv in IRIS_CENTRES:
        r = np.hypot(u - cu, v - cv)
        share = np.clip((0.114 - r) / 0.01, 0, 1)[..., None]
        image = image * (1 - share) + tinted * share
    return save(image, os.path.join(out_dir, 'eye_color.png'), 'RGB')


def cornea_material():
    """The clear cornea: fully transmissive (glTF KHR_materials_transmission), glassy, the eye's index."""
    mat = material('Eye_Cornea', roughness=0.02)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    bsdf.inputs['IOR'].default_value = 1.376
    return mat


def build(gender):
    spec = CHARACTERS[gender]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = TargetService.get_default_macro_info_dict()
    macro.update(spec['macro'])
    macro['race'] = dict(spec['race'])
    human = HumanService.create_human(macro_detail_dict=macro)
    TargetService.bake_targets(human)
    rig = HumanService.add_builtin_rig(human, 'mixamo')

    proxies = {}
    for kind, name in COMMON_PROXIES + spec['proxies']:
        path = prepare_asset(kind, name)
        obj = HumanService.add_mhclo_asset(path, human, asset_type=ASSET_TYPES[kind], subdiv_levels=0,
                                           material_type='NONE')
        depth = next((int(line.split()[1]) for line in open(path) if line.startswith('z_depth')), 50)
        proxies[obj.name] = {'kind': kind, 'name': name, 'path': path, 'object': obj, 'depth': depth}

    eyes = next(p['object'] for p in proxies.values() if p['kind'] == 'eyes')
    eye_centres = add_eye_bones(rig, eyes)

    # Blinks: on the body from MakeHuman's expression units, on each proxy through its binding.
    deltas = blink_deltas(human, spec['race'])
    for key, delta in deltas.items():
        add_shape_key(human, key, delta)
    for proxy in proxies.values():
        obj = proxy['object']
        refs, weights = proxy_binding(proxy['path'])
        assert len(refs) == len(obj.data.vertices), obj.name
        set_point_attribute(obj, '_MHREF', refs)
        set_point_attribute(obj, '_MHW', weights)
        if proxy['kind'] in ('eyes', 'teeth', 'tongue', 'clothes'):
            continue
        for key, delta in deltas.items():
            moved = (weights[:, :, None] * delta[refs.astype(int)]).sum(1)
            if np.abs(moved).max() > 1e-5:
                add_shape_key(obj, key, moved)

    # The body: its base mesh index kept on each vertex, then the head's own layout.
    mesh = human.data
    set_point_attribute(human, '_MHVERT', np.arange(len(mesh.vertices)))
    atlas = np.zeros(len(mesh.loops) * 2)
    mesh.uv_layers.active.data.foreach_get('uv', atlas)
    atlas = atlas.reshape(-1, 2)
    head_faces, head_uv, layout_notes = head_layout(mesh, atlas)

    out_dir = os.path.join(WORK, gender)
    os.makedirs(out_dir, exist_ok=True)
    textures = make_textures(gender, spec, mesh, atlas, head_faces, head_uv, out_dir)

    new_uv = atlas.copy()
    for loop, uv in head_uv.items():
        new_uv[loop] = uv
    mesh.uv_layers.active.data.foreach_set('uv', new_uv.ravel())
    mesh.materials.clear()
    mesh.materials.append(material('Body_Skin', color=textures['body'], roughness=0.62))
    mesh.materials.append(material('Head_Skin', color=textures['head'], normal=textures['head_normal'],
                                   rough=textures['head_rough']))
    for poly in mesh.polygons:
        poly.material_index = 1 if poly.index in head_faces else 0

    # Proxy materials.
    for proxy in proxies.values():
        obj = proxy['object']
        tex = mhmat_textures(proxy['path'])
        kind = proxy['kind']
        obj.data.materials.clear()
        if kind == 'eyes':
            eye_texture = os.path.join(ARGS.assets, 'eyes', 'materials', spec['eyes'] + '_eye.png')
            split_eyes(obj, eye_colour(eye_texture, out_dir))
            continue
        if kind == 'clothes':
            color = clothes_colour(tex, out_dir, proxy['name'])
            normal = export_copy(tex['normalmap'], out_dir, proxy['name'] + '_normal.png', 'RGB', size=1024) if 'normalmap' in tex else None
            mat = material('Outfit_' + proxy['name'], color=color, normal=normal, roughness=0.85)
        elif kind == 'hair':
            color = hair_colour(tex['diffuse'], out_dir, spec.get('hair_tint'))
            normal = export_copy(tex['normalmap'], out_dir, 'hair_normal.png', 'RGB', size=1024) if 'normalmap' in tex else None
            mat = material('Hair', color=color, normal=normal, alpha='mask', cutoff=0.35, roughness=0.55, double_sided=True)
        elif kind == 'eyebrows':
            color = export_copy(tex['diffuse'], out_dir, 'eyebrow_color.png', 'RGBA', size=256)
            mat = material('Eyebrows', color=color, alpha='blend', roughness=0.8, double_sided=True)
        elif kind == 'eyelashes':
            color = export_copy(tex['diffuse'], out_dir, 'eyelash_color.png', 'RGBA', size=256)
            mat = material('Eyelashes', color=color, alpha='blend', roughness=0.8, double_sided=True)
        elif kind == 'teeth':
            color = export_copy(tex['diffuse'], out_dir, 'teeth_color.png', 'RGB', size=256)
            mat = material('Teeth', color=color, roughness=0.3)
        else:
            color = export_copy(tex['diffuse'], out_dir, 'tongue_color.png', 'RGB', size=256)
            mat = material('Tongue', color=color, roughness=0.4)
        obj.data.materials.append(mat)
        obj.name = obj.data.name = MESH_NAMES[kind] if kind in MESH_NAMES else 'Outfit_' + proxy['name']

    # Every base mesh vertex at rest (helpers and hidden skin too: the eyes,
    # teeth and clothes are bound to them), for the fitting.
    basemesh = world_coordinates(human)

    # Helpers and the skin under the clothes go: of what the clothes' masks
    # hid, the skin the cloth stands over (a ray out along its normal meets
    # it), not what shows through an opening (an open collar).
    masked = set()
    for group in human.vertex_groups:
        if group.name.startswith('Delete.'):
            for v in mesh.vertices:
                for g in v.groups:
                    if g.group == group.index and g.weight > 0.5:
                        masked.add(v.index)
    clothes = [p for p in proxies.values() if p['kind'] == 'clothes']
    trees = cloth_trees([p['object'] for p in clothes])
    covered = [v for v in sorted(masked) if under_cloth(human, v, trees)]
    delete_vertices(human, sorted(set(covered) | set(range(BODY_VERTICES, len(mesh.vertices)))))
    # So too each garment under one worn over it (socks inside the jeans).
    for inner in clothes:
        outer = [p['object'] for p in clothes if p['depth'] > inner['depth']]
        if outer:
            trees = cloth_trees(outer)
            obj = inner['object']
            delete_vertices(obj, [v.index for v in obj.data.vertices if under_cloth(obj, v.index, trees)])
    for modifier in list(human.modifiers):
        if modifier.type != 'ARMATURE':
            human.modifiers.remove(modifier)
    for group in list(human.vertex_groups):
        if not group.name.startswith('mixamorig:'):
            human.vertex_groups.remove(group)
    human.name = human.data.name = 'Body'
    eyes.name = eyes.data.name = 'Eyes'

    # Standing on the floor: the lowest visible point at zero.
    lowest = min(world_coordinates(obj)[:, 2].min() for obj in [human] + [p['object'] for p in proxies.values()])
    rig.location.z -= lowest
    for bone in rig.data.bones:
        bone.name = bone.name.replace('mixamorig:', '')
    rig.name = rig.data.name = 'Armature'

    path = os.path.join(ARGS.out, f'mpfb-base-{gender}.raw.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig, human] + [p['object'] for p in proxies.values()]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False,
        export_attributes=True, export_image_format='AUTO', export_tangents=False, export_extras=False,
        export_def_bones=False, export_rest_position_armature=True,
    )
    # Blender's axes to glTF's: (x, z, -y), on the floor as the rig now stands.
    gltf = np.column_stack([basemesh[:, 0], basemesh[:, 2] - lowest, -basemesh[:, 1]]).astype('<f4')
    with open(os.path.join(ARGS.out, f'mpfb-base-{gender}.basemesh.bin'), 'wb') as fh:
        fh.write(gltf.tobytes())
    meta = describe(gender, spec, rig, human, proxies, layout_notes, eye_centres, lowest)
    with open(os.path.join(ARGS.out, f'mpfb-base-{gender}.json'), 'w') as fh:
        json.dump(meta, fh, indent=1, ensure_ascii=False)
    print('wrote', path)


def hair_colour(source, out_dir, tint):
    """The hair's texture at 1K, its colour multiplied by `tint` (alpha kept)."""
    image = load_image(source, 'RGBA').resize((1024, 1024), Image.LANCZOS)
    if tint:
        rgba = np.asarray(image, np.float32) / 255
        rgba[..., :3] *= np.array(tint, np.float32)
        image = Image.fromarray(np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    path = os.path.join(out_dir, 'hair_color.png')
    image.save(path)
    return path


def export_copy(source, out_dir, name, mode, size=None):
    image = load_image(source, mode)
    if size and max(image.size) > size:
        image = image.resize((size, size), Image.LANCZOS)
    path = os.path.join(out_dir, name)
    image.save(path)
    return path


# The MakeHuman logo printed on the women's T-shirt, painted over from the
# same place on its back (texture UV box, v up).
LOGOS = {'female_casualsuit01': {'box': (0.705, 0.68, 0.885, 0.875), 'from_du': -0.487}}


def clothes_colour(tex, out_dir, name):
    image = np.asarray(load_image(tex['diffuse'], 'RGB'), np.float32) / 255
    if 'ao' in tex:
        ao = np.asarray(load_image(tex['ao'], 'L').resize(image.shape[1::-1]), np.float32) / 255
        image = image * (0.4 + 0.6 * ao[..., None])
    logo = LOGOS.get(name)
    if logo:
        h, w = image.shape[:2]
        u0, v0, u1, v1 = logo['box']
        x0, x1 = int(u0 * w), int(u1 * w)
        y0, y1 = int((1 - v1) * h), int((1 - v0) * h)
        dx = int(logo['from_du'] * w)
        patch = image[y0:y1, x0 + dx:x1 + dx]
        yy, xx = np.mgrid[0:y1 - y0, 0:x1 - x0]
        edge = np.minimum.reduce([yy, xx, y1 - y0 - 1 - yy, x1 - x0 - 1 - xx]).astype(np.float32)
        fade = np.clip(edge / 12.0, 0, 1)[..., None]
        image[y0:y1, x0:x1] = image[y0:y1, x0:x1] * (1 - fade) + patch * fade
    out = Image.fromarray(np.clip(image * 255 + 0.5, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
    path = os.path.join(out_dir, name + '_color.png')
    out.save(path)
    return path


def make_textures(gender, spec, mesh, atlas, head_faces, head_uv, out_dir):
    """The body's texture (MakeHuman's skin at 1K) and the head's, redrawn
    in its own layout: colour 2K, a fine normal map from the colour's own
    detail, and roughness (lips and mouth wetter) with the skin mask in red."""
    skin = Image.open(os.path.join(ARGS.assets, spec['skin'])).convert('RGB')
    body_path = os.path.join(out_dir, 'body_color.png')
    skin.resize((BODY_SIZE, BODY_SIZE), Image.LANCZOS).save(body_path)

    skin_arr = np.asarray(skin, np.float32) / 255
    masks = {}
    for name in ('lips', 'inside-mouth', 'eyelids'):
        masks[name] = np.asarray(load_image(os.path.join(MPFB_DATA, 'textures', f'mpfb_{name}.jpg'), 'L'), np.float32)[..., None] / 255
    triangles = []
    for face in head_faces:
        loops = list(mesh.polygons[face].loop_indices)
        for i in range(1, len(loops) - 1):
            corner = [loops[0], loops[i], loops[i + 1]]
            triangles.append([[*head_uv[l], *atlas[l]] for l in corner])
    triangles = np.array(triangles)
    (colour, lips, mouth, lids), covered = transfer(
        triangles, [skin_arr, masks['lips'], masks['inside-mouth'], masks['eyelids']], HEAD_SIZE)
    colour, grown = dilate(colour, covered, PADDING)
    colour = fill_rest(colour, grown, colour[covered].mean(0))
    head_path = save(colour, os.path.join(out_dir, 'head_color.png'), 'RGB')

    # Normal: the colour's fine detail (pores, lip lines) read as height.
    lum = colour @ np.array([0.299, 0.587, 0.114], np.float32)
    blurred = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), np.float32) / 255
    height = np.clip(lum - blurred, -0.08, 0.08) * covered
    strength = 6.0
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * strength
    normal = np.stack([-dx, -dy, np.ones_like(dx)], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal_path = save(normal * 0.5 + 0.5, os.path.join(out_dir, 'head_normal.png'), 'RGB')

    # Roughness (G) with the skin mask (R, all skin) and no metal (B).
    small = HEAD_ROUGHNESS_SIZE
    shrink = lambda a: np.asarray(Image.fromarray((np.clip(a[..., 0], 0, 1) * 255).astype(np.uint8)).resize((small, small), Image.BILINEAR), np.float32) / 255
    lips_s, mouth_s, lids_s = shrink(lips), shrink(mouth), shrink(lids)
    rough = 0.6 - 0.22 * lips_s - 0.3 * mouth_s - 0.1 * lids_s
    mask_small = np.asarray(Image.fromarray(grown.astype(np.uint8) * 255).resize((small, small), Image.NEAREST)) > 0
    rough = np.where(mask_small, rough, 0.6)
    rough_img = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1)
    rough_path = save(rough_img, os.path.join(out_dir, 'head_roughness.png'), 'RGB')
    return {'body': body_path, 'head': head_path, 'head_normal': normal_path, 'head_rough': rough_path}


def describe(gender, spec, rig, human, proxies, layout_notes, eye_centres, lowest):
    """What the fitting needs to know of the GLB (written beside it)."""
    morphs = {}
    for obj in [human] + [p['object'] for p in proxies.values()]:
        keys = obj.data.shape_keys
        if keys:
            morphs[obj.name] = [k.name for k in keys.key_blocks if k.name != 'Basis']
    return {
        'gender': gender,
        'macro': spec['macro'],
        'race': spec['race'],
        'units': 'metres; glTF +Y up, the body faces +Z, its left is +X',
        'positions': 'packed (KHR_mesh_quantization) in one volume for every mesh: at rest a stored '
                     'position p is at D · p, D = any joint\'s world matrix × its inverse bind matrix '
                     '(three.js: bones[i].matrixWorld × boneInverses[i]); a delta in metres is stored / D\'s scale',
        'fromMakeHuman': {
            'about': 'MakeHuman target deltas (decimetres, Y up, the body faces +Z, its left +X) times '
                     'scale are glTF metres on the same axes; the macro shape (gender, age, …) is '
                     'already in the GLB\'s positions',
            'scale': 0.1,
        },
        'attributes': {
            '_MHVERT': 'Body: its MakeHuman base mesh vertex index (hm08, 0..13379)',
            '_MHREF': 'every other mesh: the three base mesh vertices it follows (mhclo binding; '
                      'the eyes, teeth, tongue and clothes follow helper vertices, 13380 and up)',
            '_MHW': 'their weights; the vertex is at sum(w_k * basemesh[ref_k]) + a fixed offset',
        },
        'basemesh': {
            'file': f'mpfb-base-{gender}.basemesh.bin',
            'about': 'every base mesh vertex (19158, helpers included) at rest: float32 x, y, z in '
                     'metres, glTF axes, little-endian; a face target moves these, and through '
                     '_MHREF/_MHW the meshes bound to them',
        },
        'materials': {
            'Head_Skin': 'the head and face, own UV layout (headUV below), head_color 2048, head_normal 2048, '
                         'head_roughness 1024 (R skin mask, G roughness)',
            'Body_Skin': 'the rest of the skin, MakeHuman atlas UV, body_color 1024',
            'Eye_Sclera': 'eyeball white (eye texture)', 'Eye_Iris': 'iris and pupil (same texture)',
            'Eye_Cornea': 'the clear outer shell over each eye (KHR_materials_transmission 1, ior 1.376)',
            'Eyebrows': 'alpha cards', 'Eyelashes': 'alpha cards', 'Hair': 'alpha-cut cards',
            'Teeth': 'teeth and gums', 'Tongue': 'tongue',
        },
        'headUV': {
            'about': 'Head_Skin UVs: each island\'s source UVs mapped by uv\' = matrix · uv + offset, all '
                     'with v up (Blender\'s); the GLB\'s TEXCOORD_0 is (u, 1 - v)',
            'textureSize': HEAD_SIZE,
            'islands': layout_notes,
            'boxes': {'face': FACE_BOX, 'head': REST_BOX, 'mouth': MOUTH_BOX, 'sockets': SOCKETS_BOX},
        },
        'morphs': morphs,
        'bones': [b.name for b in rig.data.bones],
        'eyeCentres': {'about': 'glTF metres', **{side: [c[0], c[2] - lowest, -c[1]] for side, c in eye_centres.items()}},
        'proxies': {p['object'].name: f"{p['kind']}/{p['name']}" for p in proxies.values()},
        'faceTargets': 'mpfb-face-targets.json / .bin (shared by both bodies)',
    }


def write_face_targets():
    """MakeHuman's face targets, compact: per target its base mesh vertex
    indices (uint16) and deltas (int16 × TARGET_STEP metres, glTF axes)."""
    index = []
    blobs = []
    offset = 0
    for group in FACE_TARGET_GROUPS:
        folder = os.path.join(MPFB_DATA, 'targets', group)
        for name in sorted(os.listdir(folder)):
            if not name.endswith('.target.gz'):
                continue
            rows = [line.split() for line in gzip.open(os.path.join(folder, name), 'rt')
                    if line.strip() and not line.startswith('#')]
            idx = np.array([int(r[0]) for r in rows], np.uint16)
            # MakeHuman's axes are glTF's; decimetres to metres.
            delta = np.array([[float(r[1]), float(r[2]), float(r[3])] for r in rows]) * 0.1
            steps = np.clip(np.round(delta / TARGET_STEP), -32767, 32767).astype(np.int16)
            blob = idx.tobytes() + steps.tobytes()
            index.append({'name': name[:-10], 'group': group, 'offset': offset, 'count': int(len(idx))})
            blobs.append(blob)
            offset += len(blob)
    with open(os.path.join(ARGS.out, 'mpfb-face-targets.bin'), 'wb') as fh:
        fh.write(b''.join(blobs))
    with open(os.path.join(ARGS.out, 'mpfb-face-targets.json'), 'w') as fh:
        json.dump({
            'about': 'MakeHuman (MPFB2) face targets, CC0. Each entry: count uint16 base mesh vertex indices '
                     'at offset, then count×3 int16 deltas (x, y, z) in steps of `step` metres, glTF axes. '
                     'A body vertex moves by the deltas of its _MHVERT; pairs named …-decr/…-incr are one '
                     'slider\'s two ends.',
            'step': TARGET_STEP,
            'targets': index,
        }, fh, separators=(',', ':'), ensure_ascii=False)
    print('face targets', len(index), offset, 'bytes')


os.makedirs(WORK, exist_ok=True)
for name in ([ARGS.only] if ARGS.only else sorted(CHARACTERS)):
    build(name)
write_face_targets()
