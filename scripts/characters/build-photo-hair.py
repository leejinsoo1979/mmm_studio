"""Builds the hair a photo avatar can be given (apps/editor/public/characters/photoreal/hair/):
MakeHuman 1.1.1's CC0 hair proxies, plus a buzz cut made here, each bound to the MakeHuman base
mesh the way MakeHuman binds a proxy (three base mesh vertices, their weights and an offset per
hair vertex), so it is fitted to whichever base body, and whatever face, it is put on.

Run it with any Python 3 that has numpy and Pillow (no Blender needed), from any folder:

  python build-photo-hair.py --assets <makehuman data> --mpfb <mpfb2 clone>/src/mpfb \
      --base apps/editor/public/characters/photoreal --out apps/editor/public/characters/photoreal/hair

  --assets  MakeHuman 1.1.1's system assets, as for build-mpfb-base.py: Ubuntu's
            makehuman-data_1.1.1-1_all.deb unpacked, then usr/share/makehuman/data
            (only its hair/ folder is read).
  --mpfb    MPFB2 (git clone, v2.0.18, d0a32e57): the base mesh's faces (data/3dobjs/base.obj)
            and the Mixamo rig's weights (data/rigs/standard/weights.mixamo.json).
  --base    The base bodies (mpfb-base-<gender>.basemesh.bin, .json, .landmarks.json) and the
            face targets (mpfb-face-targets.*): the hair is measured on both bodies.

Each style is written as `<style>.bin` and its pictures as WebP (see `write_style` for the
layout), and `styles.json` lists them with what the photo matching reads of each. A style is
three things:

- its cards (MakeHuman's mesh and picture), tinted to a neutral brown so any colour can be
  toned from it;
- a cap under the cards, on the scalp they cover: a shell 2 mm out from the skin, drawn with a
  dense strand picture, so no skin shows between the cards from any side. Its edge fades over
  the last centimetre, under the cards' own hairline;
- per body, how densely hair grows on each scalp vertex (the skin under the hairline is tinted
  with it, and the cards' strands thin out towards it, so the hairline is soft instead of the
  cards' cut edge on bare skin).

The buzz cut is the cap alone, 1 mm out, with a picture of stubble, on a short-back-and-sides
hairline. `long01-bob` is long01 cut straight across at the jaw, a bob with no fringe (MakeHuman's
own bobs both sweep a fringe over an eye); `long01-shoulder` is long01 cut at the shoulders.
"""

import argparse
import gzip
import hashlib
import heapq
import json
import os
import struct

import numpy as np
from PIL import Image

# The styles kept (MakeHuman's names, and long01 cut at `cut` m from the eyes) and how a photo's
# hair is matched to them (hair-match.ts reads `styles.json`): length is bald, buzz, short, medium,
# long; tied for long hair gathered back; volume for hair standing well off the head.
STYLES = {
    'buzz': {'source': None, 'length': 'buzz', 'tied': False, 'volume': 'flat', 'fringe': False},
    'short02': {'source': 'short02', 'length': 'short', 'tied': False, 'volume': 'normal', 'fringe': False},
    'short03': {'source': 'short03', 'length': 'short', 'tied': False, 'volume': 'normal', 'fringe': True},
    'bob02': {'source': 'bob02', 'length': 'medium', 'tied': False, 'volume': 'normal', 'fringe': True},
    'long01-bob': {'source': 'long01', 'cut': -0.11, 'length': 'medium', 'tied': False, 'volume': 'normal', 'fringe': False},
    'long01-shoulder': {'source': 'long01', 'cut': -0.26, 'length': 'long', 'tied': False, 'volume': 'normal', 'fringe': False},
    'long01': {'source': 'long01', 'length': 'long', 'tied': False, 'volume': 'normal', 'fringe': False},
    'ponytail01': {'source': 'ponytail01', 'length': 'long', 'tied': True, 'volume': 'normal', 'fringe': False},
    'afro01': {'source': 'afro01', 'length': 'medium', 'tied': False, 'volume': 'big', 'fringe': False},
}
GENDERS = ('male', 'female')
# MakeHuman's base mesh: its first 13380 vertices are the body (the skin), the rest helpers.
BODY_VERTICES = 13380
# Bones hair may follow: the head, the neck and the spine (long hair on the back), never the
# shoulders or arms (a raised arm would drag it).
HAIR_BONES = ['Head', 'Neck', 'Spine2', 'Spine1', 'Spine']
# The pictures' size; the cap's strand picture (u around the head, v in from the cap's edge).
TEXTURE_SIZE = 1024
CAP_TEXTURE = (512, 256)
# How far out from the skin the cap stands (m), and the buzz cut.
CAP_LIFT = 0.002
BUZZ_LIFT = 0.001
# MakeHuman's hair proxies' scale references (short02's): base mesh vertex pairs per axis and their
# distance on MakeHuman's reference body (decimetres).
BUZZ_SCALES = {'x': [5399, 11998, 1.4340], 'y': [791, 881, 2.4098], 'z': [962, 5320, 2.0001]}
# A skin vertex is under the cards when a ray out along its normal meets them this near (m).
COVER_REACH = 0.05
COVER_REACH_BIG = 0.12
# The cap's edge: how far in from the edge of what the cards cover it starts (m), and the
# distance (m) over which its strand picture's v runs from the edge (0) to fully dense.
CAP_INSET = 0.008
CAP_FADE = 0.012
CAP_V_SPAN = 0.08
# The buzz cut's hairline: stubble thinning out over this much (m) about the hairline's edge.
BUZZ_FADE = 0.008
# The scalp tint: from nothing this far outside the covered region's edge to full this far in (m).
TINT_OUT = 0.008
TINT_IN = 0.015
# The strands thin out to this much of their alpha at the edge of what the cards cover, from this
# far in (m): the hairline is fine hair thinning onto the tinted skin, not the cards' cut edge.
HAIRLINE_ALPHA = 0.55
HAIRLINE_FADE = 0.012
# Where hair may grow on the head, from the eyes' midpoint (m): the forehead above this, the
# temples (ahead of the ears) above this, behind the ears above the nape.
HAIRLINE_FRONT = 0.065
HAIRLINE_TEMPLE = 0.01
HAIRLINE_NAPE = -0.075
# A short style's cards and cap end here (m below the eyes): short hair is tapered at the nape,
# its lowest strands painted (the scalp tint) rather than cards hanging over the neck.
SHORT_NAPE = -0.042
SHORT_TAPER = 0.010
# How much of a strand's alpha is left where the nape taper ends.
SHORT_FADE = 0.2
# A cut style's strands thin out over this much (m) above the cut, to this much of their alpha.
CUT_FADE = 0.025
CUT_ALPHA = 0.5
# The cards' highlights (lightness over the picture's median) roll off towards this: some of
# MakeHuman's pictures carry strands ten times their median, which toned to a photo's colour
# read as white streaks, or as bare skin at a parting.
HIGHLIGHT = 2.2
# The probe the bench looks for holes on (scripts/photo-avatar/page/main.ts, onScalp): every
# style but the buzz cut keeps its cap over all of it.
PROBE_CROWN = 0.09
PROBE_BACK = 0.03
PROBE_NAPE = -0.02
# The neutral brown every style's cards are tinted to (linear median), so toning to a photo's
# colour never needs a large gain.
NEUTRAL = np.array([0.090, 0.060, 0.042], np.float32)
WEBP_QUALITY = 88


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', required=True)
    parser.add_argument('--mpfb', required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--only', nargs='*')
    return parser.parse_args()


# ---------------------------------------------------------------- reading


def read_mhclo(path):
    """A proxy's binding: per vertex three base mesh vertices, weights and an offset (MakeHuman's
    axes and decimetres), and the base mesh distances the offsets scale by."""
    refs, weights, offsets, scales = [], [], [], {}
    reading = False
    for line in open(path, encoding='utf8', errors='surrogateescape'):
        words = line.split()
        if not words or words[0].startswith('#'):
            if reading and not words:
                reading = False
            continue
        if words[0] in ('x_scale', 'y_scale', 'z_scale'):
            scales[words[0][0]] = [int(words[1]), int(words[2]), float(words[3])]
        elif words[0] == 'verts':
            reading = True
        elif reading:
            if not words[0].lstrip('-').isdigit():
                # As MPFB reads it: a material line inside the vertex list doesn't end it.
                reading = words[0] in ('material', 'vertexboneweights')
                continue
            if len(words) == 1:
                v = int(words[0])
                refs.append((v, v, v))
                weights.append((1.0, 0.0, 0.0))
                offsets.append((0.0, 0.0, 0.0))
            else:
                refs.append(tuple(int(w) for w in words[:3]))
                weights.append(tuple(float(w) for w in words[3:6]))
                offsets.append(tuple(float(w) for w in words[6:9]))
    return (np.array(refs, np.int64), np.array(weights, np.float64), np.array(offsets, np.float64), scales)


def read_proxy_mesh(folder, name):
    """A proxy's mesh as MakeHuman ships it compiled: positions, UVs (v up) and quads."""
    z = np.load(os.path.join(folder, name + '.npz'))
    return z['coord'], z['texco'], z['fvert'], z['fuvs']


def read_base_faces(mpfb):
    """The base mesh's skin quads (base mesh vertex indices)."""
    faces = []
    for line in open(os.path.join(mpfb, 'data', '3dobjs', 'base.obj')):
        if line.startswith('f '):
            face = [int(word.split('/')[0]) - 1 for word in line.split()[1:]]
            if max(face) < BODY_VERTICES:
                faces.append(face)
    return faces


def read_bone_weights(mpfb):
    """Per base mesh vertex, its weight on each of HAIR_BONES (MPFB's Mixamo rig)."""
    data = json.load(open(os.path.join(mpfb, 'data', 'rigs', 'standard', 'weights.mixamo.json')))
    table = np.zeros((19158, len(HAIR_BONES)), np.float64)
    for bone, pairs in data['weights'].items():
        name = bone.replace('mixamorig:', '')
        if name in HAIR_BONES:
            for v, w in pairs:
                table[v, HAIR_BONES.index(name)] = w
    return table


def read_body(base, gender):
    meta = json.load(open(os.path.join(base, f'mpfb-base-{gender}.json')))
    positions = np.fromfile(os.path.join(base, f'mpfb-base-{gender}.basemesh.bin'), '<f4').reshape(-1, 3).astype(np.float64)
    marks = json.load(open(os.path.join(base, f'mpfb-base-{gender}.landmarks.json')))
    left, right = np.array(meta['eyeCentres']['Left']), np.array(meta['eyeCentres']['Right'])

    def landmark(i):
        return sum(w * positions[v] for v, w in zip(marks['vertices'][i], marks['weights'][i]))

    # As head-model.ts reads them: the eyes' midpoint and the ears' front.
    eyes = (left + right) / 2
    ear_z = (landmark(234)[2] + landmark(454)[2]) / 2 - 0.01
    return {'positions': positions, 'eyes': eyes, 'ear_z': ear_z}


def ear_vertices(base):
    """The ears' vertices: what MakeHuman's ear-moving targets move most."""
    index = json.load(open(os.path.join(base, 'mpfb-face-targets.json')))
    data = open(os.path.join(base, 'mpfb-face-targets.bin'), 'rb').read()
    ears = set()
    for target in index['targets']:
        if target['name'] not in ('l-ear-trans-up', 'r-ear-trans-up'):
            continue
        n = target['count']
        idx = np.frombuffer(data, '<u2', n, target['offset'])
        delta = np.frombuffer(data, '<i2', n * 3, target['offset'] + 2 * n).reshape(-1, 3).astype(np.float64)
        size = np.linalg.norm(delta, axis=1)
        ears.update(int(v) for v in idx[size > 0.9 * size.max()])
    return ears


# ---------------------------------------------------------------- geometry


def offset_size(positions, scales):
    """What an offset is multiplied by on a base mesh, per axis: the base mesh's head distance
    over the proxy's reference one (metres per MakeHuman unit)."""
    size = np.ones(3)
    for axis, k in (('x', 0), ('y', 1), ('z', 2)):
        if axis in scales:
            a, b, reference = scales[axis]
            size[k] = abs(positions[a, k] - positions[b, k]) / reference
    return size


def fit(positions, refs, weights, offsets, scales):
    """Where each proxy vertex sits on a base mesh (metres, glTF axes, which are MakeHuman's):
    sum of w_k * base[ref_k] plus the offset scaled as the base mesh's head is (MPFB's fitting)."""
    return (weights[:, :, None] * positions[refs]).sum(1) + offsets * offset_size(positions, scales)


def vertex_normals(positions, faces):
    normals = np.zeros_like(positions)
    for face in faces:
        p = positions[face]
        for i in range(1, len(face) - 1):
            n = np.cross(p[i] - p[0], p[i + 1] - p[0])
            normals[[face[0], face[i], face[i + 1]]] += n
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.maximum(length, 1e-12)


def ray_hits(origins, directions, triangles, reach):
    """Whether each ray meets any triangle within `reach` (Moller-Trumbore, batched)."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    e1, e2 = b - a, c - a
    hit = np.zeros(len(origins), bool)
    for start in range(0, len(origins), 128):
        o = origins[start:start + 128, None, :]
        d = directions[start:start + 128, None, :]
        p = np.cross(d, e2[None])
        det = (e1[None] * p).sum(-1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        s = o - a[None]
        u = (s * p).sum(-1) * inv
        q = np.cross(s, e1[None])
        v = (d * q).sum(-1) * inv
        t = (e2[None] * q).sum(-1) * inv
        inside = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0) & (t < reach)
        hit[start:start + 128] = inside.any(1)
    return hit


def neighbours(faces, count):
    links = [set() for _ in range(count)]
    for face in faces:
        for i in range(len(face)):
            a, b = face[i], face[(i + 1) % len(face)]
            links[a].add(b)
            links[b].add(a)
    return links


def grow(region, links, steps):
    region = set(region)
    for _ in range(steps):
        region |= {n for v in region for n in links[v]}
    return region


def shrink(region, links, steps):
    region = set(region)
    for _ in range(steps):
        region = {v for v in region if all(n in region for n in links[v])}
    return region


def distance_in(region, links, positions, outside):
    """Each region vertex's distance (m, along the mesh) to the nearest vertex of `outside`."""
    dist = {}
    heap = []
    for v in outside:
        dist[v] = 0.0
        heapq.heappush(heap, (0.0, v))
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist.get(v, np.inf):
            continue
        for n in links[v]:
            if n not in region and n not in outside:
                continue
            nd = d + float(np.linalg.norm(positions[v] - positions[n]))
            if nd < dist.get(n, np.inf):
                dist[n] = nd
                heapq.heappush(heap, (nd, n))
    return dist


def cut_cards(cut, bodies, refs, weights, offsets, uv, triangles, scales):
    """Cards cut straight across at `cut` (m from the eyes, on both bodies): what hangs below it
    dropped, triangles across it clipped there. A vertex made on the cut is bound as the vertex
    above it is, with the offset that puts it on the cut on the male body (the female's is then
    on it to within her head's scale). Also each vertex's alpha, the strands thinning out over
    CUT_FADE above the cut."""
    fitted = {g: fit(bodies[g]['positions'], refs, weights, offsets, scales) for g in GENDERS}
    y = np.mean([fitted[g][:, 1] - bodies[g]['eyes'][1] for g in GENDERS], axis=0)
    male = bodies['male']['positions']
    size = offset_size(male, scales)
    made = {}
    extra = []

    def on_cut(a, b):
        key = (min(a, b), max(a, b))
        if key not in made:
            upper, lower = (a, b) if y[a] >= y[b] else (b, a)
            t = (y[upper] - cut) / (y[upper] - y[lower])
            point = fitted['male'][upper] + t * (fitted['male'][lower] - fitted['male'][upper])
            bound = (weights[upper][:, None] * male[refs[upper]]).sum(0)
            made[key] = len(refs) + len(extra)
            extra.append((refs[upper], weights[upper], (point - bound) / size, uv[upper] + t * (uv[lower] - uv[upper])))
        return made[key]

    kept = []
    for tri in triangles:
        polygon = []
        for k in range(3):
            a, b = tri[k], tri[(k + 1) % 3]
            if y[a] >= cut:
                polygon.append(a)
            if (y[a] >= cut) != (y[b] >= cut):
                polygon.append(on_cut(a, b))
        kept += [(polygon[0], polygon[k], polygon[k + 1]) for k in range(1, len(polygon) - 1)]
    refs = np.concatenate([refs, np.array([e[0] for e in extra], np.int64).reshape(-1, 3)])
    weights = np.concatenate([weights, np.array([e[1] for e in extra]).reshape(-1, 3)])
    offsets = np.concatenate([offsets, np.array([e[2] for e in extra]).reshape(-1, 3)])
    uv = np.concatenate([uv, np.array([e[3] for e in extra]).reshape(-1, 2)])
    y = np.concatenate([y, np.full(len(extra), cut)])
    used = np.array(sorted({v for t in kept for v in t}), np.int64)
    remap = np.full(len(refs), -1, np.int64)
    remap[used] = np.arange(len(used))
    alpha = CUT_ALPHA + (1 - CUT_ALPHA) * np.clip((y[used] - cut) / CUT_FADE, 0, 1)
    return (refs[used], weights[used], offsets[used], uv[used], [tuple(int(remap[v]) for v in t) for t in kept],
            np.round(255 * alpha).astype(np.uint8))


def triangulate(quads):
    out = []
    for q in quads:
        q = list(q)
        if q[3] == q[2] or q[3] < 0:
            out.append((q[0], q[1], q[2]))
        else:
            out.append((q[0], q[1], q[2]))
            out.append((q[0], q[2], q[3]))
    return out


# ---------------------------------------------------------------- pictures


def neutral_cards(path):
    """The cards' picture at TEXTURE_SIZE, its colour scaled (linear) so its median is NEUTRAL;
    the strands' own light and dark kept."""
    image = Image.open(path).convert('RGBA').resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.LANCZOS)
    rgba = np.asarray(image, np.float32) / 255
    linear = np.where(rgba[..., :3] <= 0.04045, rgba[..., :3] / 12.92, ((rgba[..., :3] + 0.055) / 1.055) ** 2.4)
    solid = rgba[..., 3] > 0.5
    median = np.median(linear[solid], axis=0)
    luma = lambda c: 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    # The strands' light and dark as the picture has them, the hue the neutral brown's.
    light = luma(linear) / max(float(luma(median)), 1e-4)
    light = np.where(light > 1, 1 + (HIGHLIGHT - 1) * np.tanh((light - 1) / (HIGHLIGHT - 1)), light)
    out = np.clip(light[..., None] * NEUTRAL, 0, 1)
    srgb = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    # Colour under the cut-out parts too (the edges filter towards it, not to black).
    result = np.concatenate([srgb, rgba[..., 3:]], -1)
    return Image.fromarray(np.clip(result * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def strand_noise(width, height, seed, along=24.0):
    """Strands running along v: noise fine across u (wrapping), stretched along v."""
    rng = np.random.default_rng(seed)
    out = np.zeros((height, width), np.float32)
    for octave, weight in ((1, 0.5), (2, 0.3), (4, 0.2)):
        cols = width // 2 * octave
        rows = max(2, int(height / along * octave))
        grid = rng.random((rows + 1, cols)).astype(np.float32)
        xs = np.arange(width) / width * cols
        ys = np.arange(height) / height * rows
        x0 = np.floor(xs).astype(int) % cols
        x1 = (x0 + 1) % cols
        fx = (xs - np.floor(xs))[None]
        y0 = np.floor(ys).astype(int)
        y1 = np.minimum(y0 + 1, rows)
        fy = (ys - y0)[:, None]
        top = grid[y0][:, x0] * (1 - fx) + grid[y0][:, x1] * fx
        bottom = grid[y1][:, x0] * (1 - fx) + grid[y1][:, x1] * fx
        out += weight * (top * (1 - fy) + bottom * fy)
    return out


def cap_picture(seed=7):
    """The cap's dense strands, a little darker than the cards (hair under hair is in its own
    shade, but not so dark that a gap between cards reads as a hole), fading to nothing over
    the first rows (the cap's edge)."""
    width, height = CAP_TEXTURE
    noise = strand_noise(width, height, seed)
    light = 0.8 + 0.3 * (noise - noise.min()) / (noise.max() - noise.min())
    v = (np.arange(height) + 0.5) / height * CAP_V_SPAN
    alpha = np.clip(v / CAP_FADE, 0, 1)[:, None] * np.ones((1, width))
    colour = light[..., None] * NEUTRAL * 0.95
    return picture(colour, alpha)


def buzz_picture(seed=11):
    """Stubble: short dark strands on the skin, thinning out over the first rows (the hairline)."""
    width, height = CAP_TEXTURE
    rng = np.random.default_rng(seed)
    noise = strand_noise(width, height, seed, along=6.0)
    dots = rng.random((height, width)).astype(np.float32)
    v = (np.arange(height) + 0.5) / height * CAP_V_SPAN
    density = np.clip(v / (2 * BUZZ_FADE), 0, 1)[:, None] * 0.82
    alpha = np.clip((density - dots * 0.35 - (1 - noise) * 0.25) * 2.2, 0, 1)
    light = 0.6 + 0.4 * noise
    colour = light[..., None] * NEUTRAL
    return picture(colour, alpha)


def picture(colour, alpha):
    srgb = np.where(colour <= 0.0031308, colour * 12.92, 1.055 * np.clip(colour, 0, 1) ** (1 / 2.4) - 0.055)
    rgba = np.concatenate([srgb, alpha[..., None]], -1)
    return Image.fromarray(np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')


# ---------------------------------------------------------------- the cap and the scalp


def scalp_candidates(body, ears, count):
    """Base mesh skin vertices hair may grow on: above the forehead's and temples' hairline and,
    behind the ears, above the nape; never the ears."""
    p = body['positions']
    y = p[:BODY_VERTICES, 1] - body['eyes'][1]
    z = p[:BODY_VERTICES, 2]
    front = z > body['eyes'][2] - 0.035
    behind = z < body['ear_z']
    ok = np.where(front, y > HAIRLINE_FRONT, np.where(behind, y > HAIRLINE_NAPE, y > HAIRLINE_TEMPLE))
    return {int(v) for v in np.nonzero(ok)[0] if v not in ears}


def probe_region(body, ears):
    """The bench's scalp probe on this body (onScalp in the bench page), ears left out."""
    p = body['positions']
    y = p[:BODY_VERTICES, 1] - body['eyes'][1]
    z = p[:BODY_VERTICES, 2]
    ok = (y > PROBE_CROWN) | ((z < body['ear_z'] - PROBE_BACK) & (y > PROBE_NAPE))
    return {int(v) for v in np.nonzero(ok)[0] if v not in ears}


def covered_by(cards, card_triangles, body, faces, candidates, reach):
    """The scalp vertices the cards pass over: a ray out along the skin's normal meets them."""
    positions = body['positions']
    normals = vertex_normals(positions, faces)
    ids = np.array(sorted(candidates))
    origins = positions[ids] - normals[ids] * 0.002
    triangles = cards[np.array(card_triangles)]
    hits = ray_hits(origins, normals[ids], triangles, reach)
    return {int(v) for v, hit in zip(ids, hits) if hit}, normals


def smoothed(field, links, rounds=2):
    """A field over mesh vertices averaged with its neighbours `rounds` times (its edges softened)."""
    for _ in range(rounds):
        field = {v: 0.5 * f + 0.5 * np.mean([field.get(n, f) for n in links[v]]) for v, f in field.items()}
    return field


def signed_distance(region, domain, links, positions):
    """Each domain vertex's distance (m, along the mesh) to the edge of `region`: + inside it,
    - outside; the edge midway between its inside and outside vertices."""
    inside = region & domain
    outside = domain - region
    to_out = distance_in(inside, links, positions, {v for v in outside if any(n in inside for n in links[v])})
    to_in = distance_in(outside, links, positions, {v for v in inside if any(n in outside for n in links[v])})
    edges = [float(np.linalg.norm(positions[v] - positions[n])) for v in inside for n in links[v] if n in outside]
    half = 0.5 * float(np.mean(edges)) if edges else 0.0
    return {v: (to_out.get(v, 1.0) - half) if v in inside else -(to_in.get(v, 1.0) - half) for v in domain}


def cap_mesh(field, start, domain, faces, body, normals, lift, scales, levels=2):
    """The cap: the domain's skin triangles where `field` passes `start`, each the cap's edge
    crosses cut in four `levels` times, lifted `lift` along the skin's normals, every vertex bound to its
    base triangle by its barycentric weights (the lift an offset in the style's units, so it
    grows and shrinks with the head). UVs: u around the head, v the field past `start`
    (the cap's picture fades in from v = 0, so its edge follows the field, not the mesh)."""
    positions = body['positions']
    size = offset_size(positions, scales)
    centre = body['eyes'] + np.array([0.0, 0.0, -0.09])
    keys = {}
    vertices = []
    triangles = []

    def vertex(tri, bary, wrap):
        key = (tuple(sorted((v, round(float(w), 5)) for v, w in zip(tri, bary) if w > 1e-9)), wrap)
        if key not in keys:
            keys[key] = len(vertices)
            p = sum(w * positions[v] for v, w in zip(tri, bary))
            n = sum(w * normals[v] for v, w in zip(tri, bary))
            n = n / np.linalg.norm(n)
            f = sum(w * field[v] for v, w in zip(tri, bary))
            u = (np.arctan2(p[0] - centre[0], -(p[2] - centre[2])) / (2 * np.pi)) % 1.0
            if wrap and u < 0.5:
                u += 1.0
            vertices.append((tri, bary, n * lift / size, u, min(max(f - start, 0.0) / CAP_V_SPAN, 0.98)))
        return keys[key]

    for quad in faces:
        if not all(v in domain for v in quad) or max(field[v] for v in quad) <= start:
            continue
        for tri in triangulate([quad]):
            pieces = [np.eye(3)]
            # Only where the cap's edge passes is it cut finer; whole under the hair.
            edge = min(field[v] for v in tri) < start + CAP_FADE + 0.004
            for _ in range(levels if edge else 0):
                finer = []
                for a, b, c in pieces:
                    ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
                    finer += [np.array(t) for t in ((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca))]
                pieces = finer
            for piece in pieces:
                points = [sum(w * positions[v] for v, w in zip(tri, bary)) for bary in piece]
                us = [(np.arctan2(p[0] - centre[0], -(p[2] - centre[2])) / (2 * np.pi)) % 1.0 for p in points]
                wrap = max(us) - min(us) > 0.5
                triangles.append(tuple(vertex(tri, bary, wrap) for bary in piece))
    refs = np.array([t for t, _, _, _, _ in vertices], np.int64)
    weights = np.array([b for _, b, _, _, _ in vertices])
    offsets = np.array([o for _, _, o, _, _ in vertices])
    uvs = np.array([(u, v) for _, _, _, u, v in vertices])
    return refs, weights, offsets, uvs, triangles


def hairline_alpha(refs, weights, fields):
    """Each card vertex's alpha at the hairline: HAIRLINE_ALPHA where the scalp it is bound to is
    at the edge of what the cards cover or past it (`fields`, one per body), full HAIRLINE_FADE in,
    and full where it is bound off the scalp (long hair on the shoulders)."""
    out = np.full(len(refs), 255.0)
    for i in range(len(refs)):
        values = []
        for field in fields:
            bound = [(int(r), w) for r, w in zip(refs[i], weights[i]) if abs(w) > 1e-3]
            if all(r in field for r, _ in bound):
                values.append(sum(w * field[r] for r, w in bound))
        if values:
            share = np.clip(np.mean(values) / HAIRLINE_FADE, 0, 1)
            out[i] = 255 * (HAIRLINE_ALPHA + (1 - HAIRLINE_ALPHA) * share)
    return np.round(out).astype(np.uint8)


def scalp_tint(field):
    """How densely hair grows on each scalp vertex (0..1), by how far it is inside the hair's
    edge (`field`): none TINT_OUT outside it, full TINT_IN inside."""
    tint = {}
    for v, d in field.items():
        t = np.clip((d + TINT_OUT) / (TINT_IN + TINT_OUT), 0, 1)
        if t > 0:
            tint[v] = float(t * t * (3 - 2 * t))
    return tint


# ---------------------------------------------------------------- writing


def bone_binding(refs, weights, bone_table):
    """Each vertex's four strongest hair bones and their weights (bytes, summing to 255)."""
    w = np.clip(weights, 0, None)
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    per = (w[:, :, None] * bone_table[refs]).sum(1)
    per[per.sum(1) < 1e-6, 0] = 1.0
    order = np.argsort(-per, 1)[:, :4]
    top = np.take_along_axis(per, order, 1)
    top = top / top.sum(1, keepdims=True)
    q = np.floor(top * 255).astype(np.int64)
    q[:, 0] += 255 - q.sum(1)
    return order.astype(np.uint8), q.astype(np.uint8)


class Blob:
    def __init__(self):
        self.parts = []
        self.length = 0

    def add(self, array):
        data = np.ascontiguousarray(array).tobytes()
        offset = self.length
        self.parts.append(data)
        self.length += len(data)
        pad = (-self.length) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.length += pad
        return {'offset': offset, 'count': int(np.asarray(array).size)}


def write_part(blob, name, material, texture, refs, weights, offsets, uvs, triangles, bone_table, alpha=None):
    joints, joint_weights = bone_binding(refs, weights, bone_table)
    count = len(refs)
    index_type = '<u2' if count < 65536 else '<u4'
    extra = {'alpha': blob.add(alpha)} if alpha is not None else {}
    return {
        **extra,
        'name': name,
        'material': material,
        'texture': texture,
        'vertices': count,
        'refs': blob.add(refs.astype('<u2')),
        'weights': blob.add(weights.astype('<f4')),
        'offsets': blob.add(offsets.astype('<f4')),
        'uvs': blob.add(uvs.astype('<f4')),
        'joints': blob.add(joints),
        'jointWeights': blob.add(joint_weights),
        'indices': {**blob.add(np.array(triangles).astype(index_type)), 'type': 'u16' if index_type == '<u2' else 'u32'},
    }


def write_style(path, header, blob):
    """`<style>.bin`: "PHR1", the header's length (u32), the header (JSON, padded to 4 bytes),
    then the arrays it names (each at its offset into what follows the header, little-endian)."""
    text = json.dumps(header, separators=(',', ':')).encode()
    text += b' ' * ((-len(text)) % 4)
    with open(path, 'wb') as fh:
        fh.write(b'PHR1')
        fh.write(struct.pack('<I', len(text)))
        fh.write(text)
        for part in blob.parts:
            fh.write(part)


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def build_style(name, spec, args, bodies, faces, links, ears, bone_table):
    blob = Blob()
    header = {'style': name, 'bones': HAIR_BONES, 'scales': {}, 'parts': [], 'scalp': {}, **{k: spec[k] for k in ('length', 'tied', 'volume', 'fringe')}}
    pictures = {}
    stats = {}
    if spec['source']:
        folder = os.path.join(args.assets, 'hair', spec['source'])
        refs, weights, offsets, scales = read_mhclo(os.path.join(folder, spec['source'] + '.mhclo'))
        coord, texco, fvert, fuvs = read_proxy_mesh(folder, spec['source'])
        assert len(refs) == len(coord), name
        header['scales'] = scales
        # One vertex per (position, UV) pair the quads use.
        pairs = {}
        corner_ids = np.zeros(fvert.shape, np.int64)
        for f in range(len(fvert)):
            for k in range(4):
                key = (int(fvert[f, k]), int(fuvs[f, k]))
                if key not in pairs:
                    pairs[key] = len(pairs)
                corner_ids[f, k] = pairs[key]
        order = sorted(pairs, key=pairs.get)
        src = np.array([p for p, _ in order])
        uv = texco[np.array([t for _, t in order])].astype(np.float64)
        uv[:, 1] = 1 - uv[:, 1]
        triangles = triangulate(corner_ids)
        card_refs, card_weights, card_uv, card_triangles = refs[src], weights[src], uv, triangles
        card_offsets = offsets[src].copy()
        fitted = {g: fit(bodies[g]['positions'], refs[src], weights[src], card_offsets, scales) for g in GENDERS}
        alpha = None
        if spec.get('cut') is not None:
            card_refs, card_weights, card_offsets, card_uv, card_triangles, alpha = cut_cards(
                spec['cut'], bodies, card_refs, card_weights, card_offsets, uv, triangles, scales)
            card_cut = {g: fit(bodies[g]['positions'], card_refs, card_weights, card_offsets, scales) for g in GENDERS}
        elif spec['length'] == 'short':
            # Strands past the nape taper in, as clippers taper a short cut: their part below
            # SHORT_NAPE pressed up into a band SHORT_TAPER deep, thinning out down it (the scalp
            # tint paints the rest).
            lift = np.zeros(len(src))
            depth = np.zeros(len(src))
            for g in GENDERS:
                y = fitted[g][:, 1] - bodies[g]['eyes'][1]
                below = np.clip((SHORT_NAPE - y) / max(SHORT_NAPE - y.min(), 1e-6), 0, 1)
                want = np.where(y < SHORT_NAPE, SHORT_NAPE - below * SHORT_TAPER, y)
                lift = np.maximum(lift, (want - y) / offset_size(bodies[g]['positions'], scales)[1])
                depth = np.maximum(depth, below)
            card_offsets[:, 1] += lift
            alpha = np.round(255 * (1 - (1 - SHORT_FADE) * np.sqrt(depth))).astype(np.uint8)
            card_cut = {g: fit(bodies[g]['positions'], refs[src], weights[src], card_offsets, scales) for g in GENDERS}
        else:
            card_cut = fitted
        # A cut style shares its source's picture.
        texture = f"{spec['source']}.webp"
        pictures[texture] = neutral_cards(os.path.join(folder, next(f for f in os.listdir(folder) if f.endswith('_diffuse.png'))))
        reach = COVER_REACH_BIG if spec['volume'] == 'big' else COVER_REACH
        scalp = {}
        for gender in GENDERS:
            body = bodies[gender]
            positions = body['positions']
            # What the whole cards cover (uncut): the scalp tint keeps their natural hairline.
            candidates = scalp_candidates(body, ears, len(positions))
            covered, normals = covered_by(fitted[gender], triangles, body, faces, candidates, reach)
            # Small gaps in what the cards cover closed, specks dropped.
            covered = shrink(grow(covered, links, 2), links, 2) & candidates
            domain = grow(candidates, links, 2) - ears
            field = smoothed(signed_distance(covered, domain, links, positions), links)
            scalp[gender] = (covered, normals, domain, field)
        edge = hairline_alpha(card_refs, card_weights, [scalp[g][3] for g in GENDERS])
        alpha = edge if alpha is None else np.round(alpha.astype(np.float64) * edge / 255).astype(np.uint8)
        if alpha.min() == 255:
            alpha = None
        header['parts'].append(write_part(blob, 'cards', 'Hair', texture, card_refs, card_weights, card_offsets, card_uv, card_triangles, bone_table, alpha))
        for gender in GENDERS:
            body = bodies[gender]
            positions = body['positions']
            covered, normals, domain, field = scalp[gender]
            # The cap stays over all of the bench's probe, however thin the cards are there.
            probe = probe_region(body, ears)
            full = CAP_INSET + CAP_FADE + 0.004
            cap_field = {v: max(f, full) if v in probe else f for v, f in field.items()}
            if spec['length'] == 'short':
                cap_field = {v: f if positions[v, 1] - body['eyes'][1] > SHORT_NAPE or v in probe else min(f, CAP_INSET) for v, f in cap_field.items()}
            cap_field = smoothed(cap_field, links, 1)
            cap_field = {v: max(f, full) if v in probe or any(n in probe for n in links[v]) else f for v, f in cap_field.items()}
            part = cap_mesh(cap_field, CAP_INSET, domain, faces, body, normals, CAP_LIFT, scales)
            header['parts'].append(write_part(blob, f'cap-{gender}', 'Hair_Cap', 'cap.webp', *part, bone_table))
            tint = scalp_tint(field)
            keys = np.array(sorted(tint), np.int64)
            header['scalp'][gender] = {'vertices': blob.add(keys.astype('<u2')), 'density': blob.add(np.array([tint[int(v)] for v in keys], '<f4'))}
            eyes = body['eyes']
            stats[gender] = {
                'lowest': round(float(card_cut[gender][:, 1].min() - eyes[1]), 4),
                'covered': len(covered),
                'cap triangles': len(part[4]),
                'probe uncovered by cards': len(probe - covered),
            }
        pictures['cap.webp'] = cap_picture()
    else:
        # The buzz cut: a short-back-and-sides hairline, the cap alone, its lift scaling with the
        # head as MakeHuman's hair does.
        header['scales'] = BUZZ_SCALES
        for gender in GENDERS:
            body = bodies[gender]
            positions = body['positions']
            candidates = scalp_candidates(body, ears, len(positions))
            region = shrink(grow(candidates, links, 1), links, 2)
            domain = grow(candidates, links, 2) - ears
            field = smoothed(signed_distance(region, domain, links, positions), links)
            normals = vertex_normals(positions, faces)
            part = cap_mesh(field, -BUZZ_FADE, domain, faces, body, normals, BUZZ_LIFT, BUZZ_SCALES)
            header['parts'].append(write_part(blob, f'cap-{gender}', 'Hair', 'buzz.webp', *part, bone_table))
            tint = scalp_tint(field)
            keys = np.array(sorted(tint), np.int64)
            header['scalp'][gender] = {'vertices': blob.add(keys.astype('<u2')), 'density': blob.add(np.array([tint[int(v)] for v in keys], '<f4'))}
            stats[gender] = {'cap triangles': len(part[4])}
        pictures['buzz.webp'] = buzz_picture()
    path = os.path.join(args.out, f'{name}.bin')
    write_style(path, header, blob)
    written = {os.path.basename(path): sha256(path)}
    for file, image in pictures.items():
        target = os.path.join(args.out, file)
        image.save(target, 'WEBP', quality=WEBP_QUALITY, method=6, exact=True)
        written[file] = sha256(target)
    return written, stats


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    bodies = {g: read_body(args.base, g) for g in GENDERS}
    faces = read_base_faces(args.mpfb)
    links = neighbours(faces, BODY_VERTICES)
    ears = ear_vertices(args.base)
    bone_table = read_bone_weights(args.mpfb)
    index = {
        'about': 'Photo avatar hair (build-photo-hair.py): per style its file and what hair-match.ts matches on.',
        'styles': {name: {k: spec[k] for k in ('length', 'tied', 'volume', 'fringe')} | {'file': f'{name}.bin'} for name, spec in STYLES.items()},
    }
    sources = {}
    for name, spec in STYLES.items():
        if args.only and name not in args.only:
            continue
        written, stats = build_style(name, spec, args, bodies, faces, links, ears, bone_table)
        if spec['source']:
            folder = os.path.join(args.assets, 'hair', spec['source'])
            sources[name] = {f: sha256(os.path.join(folder, f)) for f in sorted(os.listdir(folder)) if not f.endswith('.thumb')}
        print(name, json.dumps(stats), json.dumps(written))
    with open(os.path.join(args.out, 'styles.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    print('sources', json.dumps(sources, indent=1))


main()
