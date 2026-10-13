"""Makes the photo avatar bench's MPFB truth heads: a MakeHuman body with
other macro sliders (ethnicity, age, weight, muscle) and strong face targets
(nose, chin, brow, lips), all MakeHuman/MPFB's CC0 data, written as every
base mesh vertex at rest in the same frame and order as the app's base
bodies (apps/editor/public/characters/photoreal/mpfb-base-<gender>.basemesh.bin),
so the truth's topology and UVs are the base's own and its shape is exact.
A second file holds the same head with a small expression (MakeHuman's
expression units: a slight smile, the brows a little raised).

Seeds 1 and 2 are the tuning set's heads (exaggerated nose, chin and brow on
a mostly Caucasian male; a mostly African female); seeds of 100 and more are
drawn at random for the held-out pool.

Run with Blender as a Python module (`pip install bpy`), from any folder:

  BLENDER_USER_RESOURCES=<an empty folder> python make-mpfb-heads.py \\
      --mpfb <mpfb2 clone>/src/mpfb --repo <this repository> --out <cache> --seeds 1,2

  --mpfb   https://github.com/makehumancommunity/mpfb2 at v2.0.18 (d0a32e57),
           as scripts/characters/build-mpfb-base.py.

Then `bun scripts/photo-avatar/mpfb-truth.ts <cache> 1,2` turns each into a
GLB built from the app's base body.
"""

import argparse
import gzip
import json
import os
import random
import sys

import bpy  # first: addon_utils only exists once bpy is imported
import addon_utils
import numpy as np

# The face targets each tuning head is given (MakeHuman's names, weights 0..1).
TUNING = {
    1: {
        'gender': 'male',
        'macro': {'age': 0.62, 'weight': 0.55, 'muscle': 0.55},
        'race': {'caucasian': 0.85, 'asian': 0.1, 'african': 0.05},
        'targets': {
            'nose/nose-scale-depth-incr': 0.7, 'nose/nose-hump-incr': 0.6, 'nose/nose-point-down': 0.3,
            'chin/chin-prominent-incr': 0.8, 'chin/chin-height-incr': 0.3,
            'eyebrows/eyebrows-trans-forward': 0.8, 'forehead/forehead-trans-backward': 0.35,
        },
    },
    2: {
        'gender': 'female',
        'macro': {'age': 0.55, 'weight': 0.6, 'muscle': 0.45},
        'race': {'african': 0.85, 'asian': 0.1, 'caucasian': 0.05},
        'targets': {
            'nose/nose-flaring-incr': 0.6, 'nose/nose-scale-depth-decr': 0.3,
            'mouth/mouth-upperlip-volume-incr': 0.5, 'mouth/mouth-lowerlip-volume-incr': 0.5,
            'chin/chin-prognathism-incr': 0.4, 'forehead/forehead-nubian-incr': 0.4,
        },
    },
}
# What a held-out head's random face targets are drawn from.
RANDOM_TARGETS = [
    'nose/nose-scale-depth-incr', 'nose/nose-scale-depth-decr', 'nose/nose-hump-incr', 'nose/nose-hump-decr',
    'nose/nose-point-up', 'nose/nose-point-down', 'nose/nose-flaring-incr', 'nose/nose-scale-vert-incr',
    'nose/nose-scale-vert-decr', 'nose/nose-trans-forward', 'nose/nose-trans-backward',
    'chin/chin-prominent-incr', 'chin/chin-prominent-decr', 'chin/chin-height-incr', 'chin/chin-height-decr',
    'chin/chin-prognathism-incr', 'chin/chin-prognathism-decr', 'chin/chin-width-incr', 'chin/chin-width-decr',
    'eyebrows/eyebrows-trans-forward', 'eyebrows/eyebrows-trans-backward', 'forehead/forehead-trans-forward',
    'forehead/forehead-trans-backward', 'forehead/forehead-nubian-incr', 'mouth/mouth-trans-forward',
    'mouth/mouth-trans-backward', 'mouth/mouth-upperlip-volume-incr', 'mouth/mouth-lowerlip-volume-incr',
    'cheek/l-cheek-bones-incr', 'head/head-scale-depth-incr', 'head/head-scale-depth-decr',
    'head/head-scale-horiz-incr', 'head/head-scale-horiz-decr',
]
# The small expression: MakeHuman expression units (per ethnicity) and their weights.
EXPRESSION = {'mouth-corner-puller': 0.3, 'eyebrows-left-up': 0.25, 'eyebrows-right-up': 0.25,
              'mouth-open': 0.08}
# MakeHuman target deltas are decimetres on glTF's axes.
TARGET_SCALE = 0.1


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--mpfb', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--seeds', required=True)
    return parser.parse_args(argv)


ARGS = parse_args()


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
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

TARGETS = os.path.join(ARGS.mpfb, 'data', 'targets')
PHOTOREAL = os.path.join(ARGS.repo, 'apps', 'editor', 'public', 'characters', 'photoreal')


def spec_for(seed):
    if seed in TUNING:
        return TUNING[seed]
    rng = random.Random(seed)
    weights = [rng.random() ** 2 + 0.05 for _ in range(3)]
    total = sum(weights)
    race = {name: w / total for name, w in zip(['african', 'asian', 'caucasian'], weights)}
    targets = {}
    for name in rng.sample(RANDOM_TARGETS, 6):
        # A slider's two ends are never both used.
        stem = name.rsplit('-', 1)[0]
        if any(t.rsplit('-', 1)[0] == stem for t in targets):
            continue
        targets[name] = round(rng.uniform(0.25, 0.85), 3)
    return {
        'gender': 'male' if seed % 2 else 'female',
        'macro': {'age': round(rng.uniform(0.5, 0.8), 3), 'weight': round(rng.uniform(0.35, 0.75), 3),
                  'muscle': round(rng.uniform(0.35, 0.7), 3)},
        'race': race,
        'targets': targets,
    }


def human_basemesh(macro, race):
    """Every base mesh vertex of a MakeHuman body with these macro sliders, glTF axes (not yet on the floor)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    details = TargetService.get_default_macro_info_dict()
    details.update(macro)
    details['race'] = dict(race)
    human = HumanService.create_human(macro_detail_dict=details)
    TargetService.bake_targets(human)
    co = np.zeros(len(human.data.vertices) * 3)
    human.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    matrix = np.array(human.matrix_world)
    world = co @ matrix[:3, :3].T + matrix[:3, 3]
    return np.column_stack([world[:, 0], world[:, 2], -world[:, 1]])


def target_deltas(path):
    rows = [line.split() for line in gzip.open(path, 'rt') if line.strip() and not line.startswith('#')]
    index = np.array([int(r[0]) for r in rows])
    delta = np.array([[float(r[1]), float(r[2]), float(r[3])] for r in rows]) * TARGET_SCALE
    return index, delta


def add_target(positions, path, weight):
    index, delta = target_deltas(path)
    positions[index] += weight * delta


def main():
    os.makedirs(ARGS.out, exist_ok=True)
    for seed in [int(s) for s in ARGS.seeds.split(',')]:
        spec = spec_for(seed)
        gender = spec['gender']
        meta = json.load(open(os.path.join(PHOTOREAL, f'mpfb-base-{gender}.json')))
        shipped = np.fromfile(os.path.join(PHOTOREAL, f'mpfb-base-{gender}.basemesh.bin'), '<f4').reshape(-1, 3)
        # The base body rebuilt from its own sliders gives the shift onto the shipped frame (its feet on
        # the floor): one constant, checked to hold for every vertex.
        rebuilt = human_basemesh(meta['macro'], meta['race'])
        shift = (shipped - rebuilt).mean(0)
        frame_error = float(np.abs(shipped - (rebuilt + shift)).max())
        if frame_error > 1e-4:
            sys.exit(f'seed {seed}: the rebuilt base is {frame_error} m off the shipped one')
        macro = dict(meta['macro'])
        macro.update(spec['macro'])
        head = human_basemesh(macro, spec['race']) + shift
        for name, weight in spec['targets'].items():
            add_target(head, os.path.join(TARGETS, f'{name}.target.gz'), weight)
        expressed = head.copy()
        for unit, weight in EXPRESSION.items():
            for race, share in spec['race'].items():
                add_target(expressed, os.path.join(TARGETS, 'expression', 'units', race, f'{unit}.target.gz'),
                           weight * share)
        head.astype('<f4').tofile(os.path.join(ARGS.out, f'mpfb-{seed}.basemesh.bin'))
        expressed.astype('<f4').tofile(os.path.join(ARGS.out, f'mpfb-{seed}-expression.basemesh.bin'))
        with open(os.path.join(ARGS.out, f'mpfb-{seed}.json'), 'w') as fh:
            json.dump({
                'seed': seed, 'gender': gender, 'macro': macro, 'race': spec['race'],
                'targets': spec['targets'], 'expression': EXPRESSION, 'frameError': frame_error,
                'licence': 'CC0 1.0 (MakeHuman / MPFB2 v2.0.18 data)',
            }, fh, indent=1)
        print('seed', seed, gender, 'frame error', frame_error)


main()
