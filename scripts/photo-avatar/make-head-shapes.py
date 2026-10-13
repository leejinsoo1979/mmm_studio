"""Makes the head shape space the photo avatar's fit draws on beside the face
targets: MakeHuman bodies with their macro sliders drawn at random (age,
weight, muscle, height, proportions, ethnicity: MakeHuman/MPFB's CC0 data),
each written as every base mesh vertex at rest, in the same frame and order
as the app's base bodies. `head-shapes.ts` (bun) then turns them into the
principal shapes the app ships.

The macro sliders move the whole head together — the skull, the ears and
the face — as real heads differ, which the face targets alone can't; the
spread of the samples is the prior the fit holds the shapes to.

Run with Blender as a Python module (`pip install bpy==5.0.1 numpy`):

  BLENDER_USER_RESOURCES=<an empty folder> python make-head-shapes.py \\
      --mpfb <mpfb2 clone>/src/mpfb --repo <this repository> --out <folder> --count 200

  --mpfb   https://github.com/makehumancommunity/mpfb2 at v2.0.18 (d0a32e57),
           as scripts/characters/build-mpfb-base.py.
"""

import argparse
import json
import os
import random
import sys

import bpy  # first: addon_utils only exists once bpy is imported
import addon_utils
import numpy as np


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--mpfb', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--count', type=int, default=200)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--genders', default='male,female')
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

PHOTOREAL = os.path.join(ARGS.repo, 'apps', 'editor', 'public', 'characters', 'photoreal')


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


def draw(rng, gender):
    """An adult's macro sliders: MakeHuman's age 0.5 is 25 years, 1 is 90 (below 0.42, under 20)."""
    weights = [rng.random() ** 2 + 0.05 for _ in range(3)]
    total = sum(weights)
    race = {name: w / total for name, w in zip(['african', 'asian', 'caucasian'], weights)}
    macro = {
        'gender': rng.uniform(0.85, 1.0) if gender == 'male' else rng.uniform(0.0, 0.15),
        'age': rng.uniform(0.42, 0.95),
        'muscle': rng.uniform(0.15, 0.9),
        'weight': rng.uniform(0.15, 0.9),
        'height': rng.uniform(0.15, 0.9),
        'proportions': rng.uniform(0.3, 1.0),
    }
    return macro, race


def main():
    os.makedirs(ARGS.out, exist_ok=True)
    for gender in ARGS.genders.split(','):
        meta = json.load(open(os.path.join(PHOTOREAL, f'mpfb-base-{gender}.json')))
        shipped = np.fromfile(os.path.join(PHOTOREAL, f'mpfb-base-{gender}.basemesh.bin'), '<f4').reshape(-1, 3)
        rebuilt = human_basemesh(meta['macro'], meta['race'])
        shift = (shipped - rebuilt).mean(0)
        frame_error = float(np.abs(shipped - (rebuilt + shift)).max())
        if frame_error > 1e-4:
            sys.exit(f'{gender}: the rebuilt base is {frame_error} m off the shipped one')
        rng = random.Random(ARGS.seed * 1000 + (0 if gender == 'male' else 1))
        heads = np.zeros((ARGS.count, shipped.shape[0], 3), '<f4')
        specs = []
        for i in range(ARGS.count):
            macro, race = draw(rng, gender)
            full = dict(meta['macro'])
            full.update(macro)
            heads[i] = human_basemesh(full, race) + shift
            specs.append({'macro': full, 'race': race})
            if i % 20 == 0:
                print(gender, i, flush=True)
        heads.tofile(os.path.join(ARGS.out, f'heads-{gender}.bin'))
        with open(os.path.join(ARGS.out, f'heads-{gender}.json'), 'w') as fh:
            json.dump({'gender': gender, 'count': ARGS.count, 'vertices': int(shipped.shape[0]),
                       'seed': ARGS.seed, 'specs': specs,
                       'licence': 'CC0 1.0 (MakeHuman / MPFB2 v2.0.18 data)'}, fh, indent=1)


main()
