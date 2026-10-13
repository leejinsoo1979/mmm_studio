"""Turns the heads `make-head-shapes.py` drew into the principal head shapes the
photo avatar's fit ships (apps/editor/public/characters/photoreal/
mpfb-head-shapes-<gender>.json / .bin), in the face targets' compact format.

Each head is put on the base body's head by a similarity (its size is the
fit's own unknown, held by the pupils' distance), the fitted region's moves
fade down the neck as the face targets' do, and the moves' principal
directions are kept, each scaled to its spread among the heads: a shape's
weight 1 is one standard deviation, and the fit holds the weights to 0 ± 1.

  python head-shapes.py --heads <make-head-shapes.py's folder> --repo <this repository>
"""

import argparse
import json
import os

import numpy as np

STEP = 1e-5
NECK_REACH = 0.07
NECK_BLEND = 0.04


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--heads', required=True)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--keep', type=float, default=0.995, help='share of the moves the kept shapes explain')
    parser.add_argument('--most', type=int, default=12, help='the most shapes kept')
    parser.add_argument('--out', help='default: the repo\'s photoreal folder')
    return parser.parse_args()


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def similarity(src, dst):
    """The scale, rotation and translation taking src (n×3) closest to dst (Umeyama)."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    u, s, vt = np.linalg.svd(b.T @ a)
    d = np.sign(np.linalg.det(u @ vt))
    fix = np.diag([1, 1, d])
    rotation = u @ fix @ vt
    scale = (s * np.diag(fix)).sum() / (a * a).sum()
    return scale, rotation, md - scale * rotation @ ms


def main():
    args = parse_args()
    photoreal = os.path.join(args.repo, 'apps', 'editor', 'public', 'characters', 'photoreal')
    out = args.out or photoreal
    for gender in ['male', 'female']:
        meta = json.load(open(os.path.join(args.heads, f'heads-{gender}.json')))
        heads = np.fromfile(os.path.join(args.heads, f'heads-{gender}.bin'), '<f4').reshape(meta['count'], -1, 3)
        base = np.fromfile(os.path.join(photoreal, f'mpfb-base-{gender}.basemesh.bin'), '<f4').reshape(-1, 3)
        marks = json.load(open(os.path.join(photoreal, f'mpfb-base-{gender}.landmarks.json')))
        chin_y = sum(base[v, 1] * w for v, w in zip(marks['vertices'][152], marks['weights'][152]))
        floor = chin_y - NECK_REACH
        region = np.nonzero(base[:, 1] > floor)[0]
        reach = smoothstep(floor, floor + NECK_BLEND, base[region, 1])
        head = np.nonzero(base[:, 1] > chin_y)[0]
        moves = np.zeros((len(heads), len(region), 3))
        for i, h in enumerate(heads):
            scale, rotation, shift = similarity(h[head].astype(np.float64), base[head].astype(np.float64))
            placed = (scale * h[region] @ rotation.T) + shift
            moves[i] = (placed - base[region]) * reach[:, None]
        flat = moves.reshape(len(heads), -1)
        _, s, vt = np.linalg.svd(flat, full_matrices=False)
        energy = np.cumsum(s ** 2) / (s ** 2).sum()
        count = int(min(args.most, np.searchsorted(energy, args.keep) + 1))
        spread = s / np.sqrt(len(heads))
        rest = flat - (flat @ vt[:count].T) @ vt[:count]
        rms = lambda m: float(np.sqrt((m.reshape(len(heads), -1, 3) ** 2).sum(2).mean()) * 1000)
        print(gender, 'heads', len(heads), 'shapes kept', count, 'explained %.4f' % energy[count - 1],
              'moves %.2f mm RMS, %.2f mm left' % (rms(flat), rms(rest)),
              'each shape (mm RMS):', ' '.join('%.2f' % (spread[k] * 1000 / np.sqrt(len(region))) for k in range(count)))
        index = []
        blobs = []
        offset = 0
        for k in range(count):
            shape = (spread[k] * vt[k]).reshape(-1, 3)
            steps = np.clip(np.round(shape / STEP), -32767, 32767).astype(np.int16)
            moving = np.nonzero(np.abs(steps).max(1) > 0)[0]
            blob = region[moving].astype(np.uint16).tobytes() + steps[moving].tobytes()
            index.append({'name': f'shape-{k + 1}', 'group': 'shape', 'offset': offset, 'count': int(len(moving))})
            blobs.append(blob)
            offset += len(blob)
        with open(os.path.join(out, f'mpfb-head-shapes-{gender}.bin'), 'wb') as fh:
            fh.write(b''.join(blobs))
        with open(os.path.join(out, f'mpfb-head-shapes-{gender}.json'), 'w') as fh:
            json.dump({
                'about': 'Principal head shapes of MakeHuman (MPFB2) bodies with random macro sliders, CC0, made by '
                         'scripts/photo-avatar/make-head-shapes.py and head-shapes.py. Same layout as '
                         'mpfb-face-targets.json; a shape at weight 1 is one standard deviation of the heads.',
                'step': STEP,
                'heads': len(heads),
                'seed': meta['seed'],
                'targets': index,
            }, fh, separators=(',', ':'), ensure_ascii=False)
        print(gender, 'wrote', offset, 'bytes')


main()
