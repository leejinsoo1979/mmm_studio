"""Builds `mpfb-face-expressions.bin` + `.json`: the face's expression
shapes for photo avatars (사진 아바타), named as ARKit's blend shapes so the
game's face motion (jawOpen, mouthSmileLeft, browInnerUp, …) can drive them.
Each is made from MakeHuman's expression units in MPFB2 (CC0), mixed per
race as the base bodies were built (their `race` in mpfb-base-<gender>.json),
on the base mesh's every vertex, helpers included, so the teeth and tongue
(bound to the mouth's helpers) move with the jaw. MakeHuman's mouth-open
leaves the tongue where it was, up against the palate behind the upper
teeth, where an open mouth shows it instead of them: wherever a shape moves
the lower teeth, the tongue here goes with them, rigidly.

Plain Python with numpy, no Blender:

  python build-mpfb-expressions.py --mpfb <mpfb2 clone>/src/mpfb \\
      --out apps/editor/public/characters/photoreal

  --mpfb  https://github.com/makehumancommunity/mpfb2 (git clone; built
          against v2.0.18, d0a32e57), as build-mpfb-base.py.
  --out   the folder with the base bodies' .json; the two files are written there.

The format is mpfb-face-targets'.
"""

import argparse
import gzip
import json
import os

import numpy as np

# Each expression: the units it is made of, their weights, and the side of
# the face it keeps (MakeHuman's units for the mouth move both sides; the
# subject's left is +x).
EXPRESSIONS = [
    ('eyeBlinkLeft', [('eye-left-closure', 1.0, None)]),
    ('eyeBlinkRight', [('eye-right-closure', 1.0, None)]),
    ('eyeSquintLeft', [('eye-left-slit', 1.0, None)]),
    ('eyeSquintRight', [('eye-right-slit', 1.0, None)]),
    ('eyeWideLeft', [('eye-left-opened-up', 1.0, None)]),
    ('eyeWideRight', [('eye-right-opened-up', 1.0, None)]),
    ('browDownLeft', [('eyebrows-left-down', 1.0, None)]),
    ('browDownRight', [('eyebrows-right-down', 1.0, None)]),
    ('browInnerUp', [('eyebrows-left-inner-up', 1.0, None), ('eyebrows-right-inner-up', 1.0, None)]),
    ('browOuterUpLeft', [('eyebrows-left-extern-up', 1.0, None)]),
    ('browOuterUpRight', [('eyebrows-right-extern-up', 1.0, None)]),
    ('jawOpen', [('mouth-open', 1.0, None)]),
    ('mouthSmileLeft', [('mouth-corner-puller', 1.0, 'left')]),
    ('mouthSmileRight', [('mouth-corner-puller', 1.0, 'right')]),
    ('mouthFrownLeft', [('mouth-depression', 1.0, 'left')]),
    ('mouthFrownRight', [('mouth-depression', 1.0, 'right')]),
    ('mouthStretchLeft', [('mouth-retraction', 1.0, 'left')]),
    ('mouthStretchRight', [('mouth-retraction', 1.0, 'right')]),
    ('mouthUpperUpLeft', [('mouth-elevation', 1.0, 'left')]),
    ('mouthUpperUpRight', [('mouth-elevation', 1.0, 'right')]),
    ('mouthLowerDownLeft', [('mouth-depression-retraction', 1.0, 'left')]),
    ('mouthLowerDownRight', [('mouth-depression-retraction', 1.0, 'right')]),
    ('mouthPressLeft', [('mouth-compression', 1.0, 'left')]),
    ('mouthPressRight', [('mouth-compression', 1.0, 'right')]),
    ('mouthPucker', [('mouth-pursing', 1.0, None)]),
    ('mouthFunnel', [('mouth-protusion', 1.0, None)]),
    ('noseSneerLeft', [('nose-left-elevation', 1.0, None)]),
    ('noseSneerRight', [('nose-right-elevation', 1.0, None)]),
]
# Across the middle of the face (m), a one-sided shape fades from all to none.
SIDE_BLEND = 0.01
# Deltas are int16 steps of this many metres (as the face targets).
STEP = 1e-5
# A shape that moves the lower teeth further than this (m) takes the tongue along.
JAW_MOVES = 0.001
GENDERS = ('male', 'female')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mpfb', required=True)
    parser.add_argument('--out', required=True)
    return parser.parse_args()


def base_mesh(mpfb):
    """Every base mesh vertex at rest (m), MakeHuman's default body, and
    each face group's vertices (0-based) by the group's name."""
    positions = []
    groups = {}
    group = None
    with open(os.path.join(mpfb, 'data', '3dobjs', 'base.obj')) as fh:
        for line in fh:
            if line.startswith('v '):
                positions.append([float(w) * 0.1 for w in line.split()[1:4]])
            elif line.startswith('g '):
                group = groups.setdefault(line.split()[1], set())
            elif line.startswith('f ') and group is not None:
                group.update(int(w.split('/')[0]) - 1 for w in line.split()[1:])
    return np.array(positions), {name: np.array(sorted(vs)) for name, vs in groups.items()}


def follow(rest, total, lead, led):
    """The deltas that carry `led` along with `lead`'s move, rigidly: the
    rotation and translation that best take `lead` to where `total` moves it."""
    a = rest[lead]
    b = a + total[lead]
    ca = a.mean(axis=0)
    cb = b.mean(axis=0)
    u, _, vt = np.linalg.svd((a - ca).T @ (b - cb))
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rotation = vt.T @ np.diag([1, 1, d]) @ u.T
    return (rest[led] - ca) @ rotation.T + cb - rest[led]


def load_unit(mpfb, race, unit, count):
    deltas = np.zeros((count, 3))
    path = os.path.join(mpfb, 'data', 'targets', 'expression', 'units', race, unit + '.target.gz')
    with gzip.open(path, 'rt') as fh:
        for line in fh:
            words = line.split()
            if len(words) == 4 and not line.startswith('#'):
                # MakeHuman's axes are glTF's; decimetres to metres.
                deltas[int(words[0])] = [float(w) * 0.1 for w in words[1:]]
    return deltas


def main():
    args = parse_args()
    races = []
    for gender in GENDERS:
        with open(os.path.join(args.out, f'mpfb-base-{gender}.json')) as fh:
            races.append(json.load(fh)['race'])
    if races[0] != races[1]:
        raise SystemExit('the base bodies differ in race: one expression file cannot serve both')
    race = {name: weight for name, weight in races[0].items() if weight > 0}
    rest, groups = base_mesh(args.mpfb)
    count = len(rest)
    lower_teeth = groups['helper-lower-teeth']
    tongue = np.concatenate([vs for name, vs in groups.items()
                             if name == 'helper-tongue' or name.startswith('joint-tongue-')])
    left = np.clip((rest[:, 0] + SIDE_BLEND) / (2 * SIDE_BLEND), 0, 1)
    left = left * left * (3 - 2 * left)
    side = {None: np.ones(count), 'left': left, 'right': 1 - left}

    units = {}
    index = []
    blobs = []
    offset = 0
    for name, parts in EXPRESSIONS:
        total = np.zeros((count, 3))
        for unit, weight, half in parts:
            if unit not in units:
                units[unit] = sum(w * load_unit(args.mpfb, r, unit, count) for r, w in race.items())
            total += weight * side[half][:, None] * units[unit]
        carried = np.abs(total[lower_teeth]).max() > JAW_MOVES
        if carried:
            total[tongue] = follow(rest, total, lower_teeth, tongue)
        steps = np.clip(np.round(total / STEP), -32767, 32767).astype(np.int16)
        moved = np.nonzero(np.abs(steps).max(axis=1) > 0)[0]
        blob = moved.astype(np.uint16).tobytes() + steps[moved].tobytes()
        index.append({
            'name': name,
            'offset': offset,
            'count': int(len(moved)),
            'from': [{'unit': unit, 'weight': weight, **({'side': half} if half else {})}
                     for unit, weight, half in parts],
            **({'tongue': 'follows the lower teeth'} if carried else {}),
        })
        blobs.append(blob)
        offset += len(blob)
        print(f'{name:20s} {len(moved):5d} vertices, largest move {np.abs(total).max() * 1000:.1f} mm')
    with open(os.path.join(args.out, 'mpfb-face-expressions.bin'), 'wb') as fh:
        fh.write(b''.join(blobs))
    with open(os.path.join(args.out, 'mpfb-face-expressions.json'), 'w') as fh:
        json.dump({
            'about': 'Face expression shapes named as ARKit blend shapes, from MakeHuman\'s expression units '
                     '(MPFB2, CC0) mixed by `race`. Each entry: count uint16 base mesh vertex indices at offset, '
                     'then count×3 int16 deltas (x, y, z) in steps of `step` metres, glTF axes; `from` is what '
                     'it is made of (a `side` keeps that half of the face, the subject\'s left being +x).',
            'step': STEP,
            'race': race,
            'expressions': index,
        }, fh, separators=(',', ':'), ensure_ascii=False)
    print('expressions', len(index), offset, 'bytes')


if __name__ == '__main__':
    main()
