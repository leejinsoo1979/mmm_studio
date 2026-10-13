# Photo avatar bench

Known heads are photographed with known cameras and lights. The app turns those photos into avatars
the way a user's photos are turned into one: MediaPipe reads each photo on the page (`apps/editor/lib/photo-capture.ts`),
the avatar worker fits and builds it (`packages/editor/.../photo-avatar/avatar-worker.ts`), and for the
webcam path the studio's frame picker chooses the photos (`apps/editor/lib/guided-capture.ts`). Every
acceptance gate (G1–G9) is then measured against the truth.

The bench writes the following under `--out`:

- `<head>/report.json` and `<head>/report.md` for each head.
- `gates.md` and `gates.json` across all heads.
- The input photos, likeness and skin renders, hair sheets, `avatar-five.glb` and `avatar-perturbed.glb`.

The gate numbers live in one place,
`packages/editor/src/components/editor/first-person/photo-avatar/__bench__/gates.ts`. The geometry
measure is in `__bench__/measure.ts` beside it. Both are shared by this bench and the fixture tests.

## Running

```bash
# The tuning set, every config (8–13 minutes a head, half of it the webcam clip)
bun scripts/photo-avatar/bench.ts --set tuning

# Some tuning heads and configs
bun scripts/photo-avatar/bench.ts --heads f01,mpfb-1 --configs five,three,single,perturbed

# The same, and refresh the committed fixtures the gate tests read (redistributable heads only)
bun scripts/photo-avatar/bench.ts --set tuning --configs five,three,single,perturbed --fixtures

# Held-out heads, named (verifiers only: see "Held-out pool")
bun scripts/photo-avatar/bench.ts --heldout rocketbox:Business_Male_03,mpfb:101

# The hair library's styles on both base bodies at rest (no photos): class, colour, holes
bun scripts/photo-avatar/bench.ts --hair-styles
```

| flag | meaning |
|---|---|
| `--set tuning` | every tuning head |
| `--heads a,b` | some tuning heads, by id. A held-out head is refused here. |
| `--heldout a,b` | held-out heads: `rocketbox:<Name>`, `mpfb:<seed ≥ 100>`, `scan:<name>` |
| `--configs …` | any of `five,three,single,perturbed,webcam,safari` (default: all) |
| `--out <dir>` | where reports go (default `<cache>/out/tuning` or `<cache>/out/heldout`) |
| `--cache <dir>` | the bench's cache (or `BENCH_CACHE`). It holds the MPFB and scan heads, the bundled page, the Chrome profile and the clips. Default is `$TMPDIR/photo-avatar-bench`. |
| `--fixtures` | write `__bench__/fixtures/<head>.json` for redistributable tuning heads |
| `--hair-styles` | instead of heads: every style of the hair library (`apps/editor/public/characters/photoreal/hair`) and a bald head, on both base bodies at rest, through the hair probes below; `styles.md` and `styles.json` in `--out` |
| `--styles a,b` | with `--hair-styles`: only these, by `<style>-<body>` (`short02-male`, `bald-female`) |

Environment:
- `BENCH_DISPLAY`, `BENCH_CDP` and `BENCH_HTTP` set the Xvfb display, the Chrome DevTools port and
  the page server's port (defaults 75, 9375, 8075). Use ports nobody else on the machine uses.
- `BENCH_CHROME` sets the Chromium binary (default: Playwright's
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).

Chrome runs headed on Xvfb with WebGPU on SwiftShader. Nothing else is needed: no Next server and no
network. The page is bundled with `Bun.build` from `page/main.ts`, and three.js is served from
`node_modules/three` through an import map. `page/editor-shim.ts` and `page/viewer-shim.ts` stand in
for `@pascal-app/editor` and `@pascal-app/viewer`, exporting only the modules the app's photo code
takes. If that code starts importing something new from those packages, add it to the shim.

### Configs

| config | photos | gates |
|---|---|---|
| `five` | 0°, ±45°, ±90°, chin up 2°, 768 × 1024 PNG, 70° diagonal field, 0.5 m, soft light | G1. Likeness G5, skin G6, hair G7, eyes G8 and engineering G9 are measured on this build. |
| `three` | the clean 0°, ±45° | G4 (three) |
| `single` | the clean 0° | G4 (one): beats the untouched base head, plus the UI's 옆모습 추정 label |
| `perturbed` | seeded per head: yaw ±10°, pitch ±6°, roll ±4°, one camera of 26–60 mm-eq, 1280 × 720, loose framing off-centre, JPEG q75, a small expression, hard side light | G2, plus G6 under hard light |
| `webcam` | A 17 s turntable clip of the head, with holds at ±45° and ±90° and a little nod and lean. It uses the perturbed set's focal and hard light, and is framed as close as the guide asks a person to come (the head fills 65 % of the height). It is written as 1280 × 720 MJPEG and played by Chromium's fake camera (`--use-file-for-fake-video-capture`) into the studio's real frame picker. | G3 |
| `safari` | the five clean photos built by `page/safari-worker.ts`: the worker as Safari runs it, where an `OffscreenCanvas` hands back PNG when asked for WebP | G9 (Safari-safe file); run on the first head only |

## Heads

### Tuning set

Fix tracks may render, fit and tune on these heads:

| id | head | licence | sha256 | fixture |
|---|---|---|---|---|
| f01 | Rocketbox `Female_Adult_01` (in the repo, `apps/editor/public/characters/rocketbox`) | MIT | `d05f3372…96e4bb` | yes |
| m01 | Rocketbox `Male_Adult_01` | MIT | `332615f2…c4e102` | yes |
| m05 | Rocketbox `Male_Adult_05` | MIT | `1fdc1b23…b91075` | yes |
| m10 | Rocketbox `Male_Adult_10` | MIT | `db432aa4…f62bb` | yes |
| m12 | Rocketbox `Male_Adult_12` | MIT | `61d40069…1d43` | yes |
| f03 | Rocketbox `Female_Adult_03` | MIT | `6a040cee…087f67` | yes |
| lps | Lee Perry-Smith head scan (Infinite-Realities) from the three.js r170 examples. Its size is not real, so its scale is not scored. | CC BY 3.0 | glb `402b8a8a…c9c576`, map `e976d73b…458a65` | **no**: cache only, never committed |
| mpfb-1 | MakeHuman male: an exaggerated nose, chin and brow, a mostly Caucasian macro | CC0 1.0 | glb `4d52c34a…ce50917` | yes |
| mpfb-2 | MakeHuman female: a mostly African macro, darker skin, bald | CC0 1.0 | glb `d68281282…655470a` | yes |

The two MPFB heads have the base body's own topology and UVs, so their shape is exact. Generate them
like this:

```bash
pip install bpy==5.0.1 numpy        # Blender as a Python module (Python 3.11)
git clone https://github.com/makehumancommunity/mpfb2 && git -C mpfb2 checkout d0a32e57   # v2.0.18
BLENDER_USER_RESOURCES=$(mktemp -d) python scripts/photo-avatar/make-mpfb-heads.py \
  --mpfb mpfb2/src/mpfb --repo . --out "$BENCH_CACHE" --seeds 1,2
bun scripts/photo-avatar/mpfb-truth.ts "$BENCH_CACHE" 1,2
```

LPS goes in `<cache>/lps/`, fetched from
`https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/LeePerrySmith/`
(`LeePerrySmith.glb`, `Map-COL.jpg`, `License.txt`). Check the hashes above.

### Held-out pool

Held-out heads are not in the tuning set. Fix tracks must not render, fit or read results for any of
them. Only a verifier runs `--heldout`, and it never writes fixtures. The pool:

- **Rocketbox:** every adult character in `apps/editor/public/characters/rocketbox` outside the
  tuning six (`heldOutRocketbox()` in `lib/heads.ts` lists them). Children are refused.
- **MPFB:** `mpfb:<seed>` for any seed of 100 or more. Make it first with `make-mpfb-heads.py --seeds <seed>`
  and `mpfb-truth.ts`. These seeds draw random macros and face targets.
- **Scans:** `scan:<name>`. Put `<cache>/scans/<file>` with `<name>.json` beside it, giving
  `{file, map?, gender, scale, absoluteScale, hair?, source, licence}`. Scans stay in the cache.

### Hair (G7)

- **Class.** From the avatar's hair meshes (`Hair`) at rest: bald (none), buzz (every hair vertex
  within 6 mm of the skin's surface), short (ending above the earlobes, 6 cm under the eyes),
  medium (above the chin, 13 cm under), long; long hair gathered within 5 cm of the midline at the
  back is long-tied.
- **Colour.** The median of the avatar's `hair_color` picture (alpha over half) against the
  truth's hair texture (or the hair painted on its scalp).
- **Holes.** From 8 directions (front, both sides, back, both back quarters, top, under the
  nape) in idle, walk and wave: the share of the scalp's visible pixels (crown 9 cm over the eyes,
  the back of the head above 2 cm under them) showing skin or the background through the hair, its
  cards cut by their alpha. Each view is saved (`hair/<pose>-<view>.jpg`) with its hole map
  (`hair/holes-<pose>-<view>.png`: scalp grey, holes red where skin shows, orange where it shows
  in one of the pixel's four samples only, yellow where the background does). Each view's
  `singleSample` share counts the orange ones. SwiftShader shows a surface seen edge on through
  a shell a few millimetres out in one sample now and then: two concentric spheres 2 mm apart
  give 13 such pixels of 17,559 (4 mm: 4, 8 mm: 3), all along the inner sphere's outline.
- **Tears and folds** (not gated). In each pose, the share of the hair's triangles (cards and
  cap) with an edge over 2 mm at rest that the pose makes more than 1.5 times longer or shorter
  (`stretch` beside the holes): hair bound to joints that part, folded into flaps. Long hair over
  moving clothes stretches some anyway.

## Fixture tests

`bun test packages/editor/src/components/editor/first-person/photo-avatar/__bench__/` runs
`gates.test.ts` with no browser. It takes about 25 s a head, so about 3.5 minutes for all eight
fixtures. Its numbers match the browser bench's to within about 0.15 mm.

For each committed fixture, it fits the views exactly as the worker does (`fitCapture`) and measures
the result against the truth. The gates are checked at their own limits:
- G1 on five clean photos.
- G2 on five perturbed photos.
- G4 on three photos and on one photo (against the untouched base head).

What a fixture keeps:
- **Each view's MediaPipe landmarks**, exactly.
- **Each view's mask, skin and strand maps**, as which side of 127 each pixel is on. That is all the
  fit reads of them, so the photo and the class planes are left out.
- **The truth's summary**: landmarks, a skull cloud, the side profile, the ¾ outlines and widths.

The bench's own numbers for the same views are stored in each fixture under `bench`.

Regenerate the fixtures with `--fixtures` whenever the app changes what it reads from a photo.

## How geometry is measured

- **Alignment.** The fit is put in the truth's frame by its skull and ears, using point-to-plane
  ICP (similarity):
  - It starts from a robust similarity over all face landmarks.
  - It matches only within 8 mm and keeps the closest 70 % of matches.
  - It leans weakly toward the face's turn, place and size. One degree, one millimetre or one
    percent costs as much as 30 skull points 1 mm off.
  - Its scale is the head's size error. Absolute widths are the proportional widths with that size
    put back.
- **Profile.** The side profile is the silhouette of the skin projected along x, rasterised at
  0.25 mm. Its named points are the turns of the truth's outline, walking up and down from the nose
  tip, e.g. nasion = the deepest point above the tip.
- **Point errors.** The fit's outline minus the truth's at the same height: depth for face points,
  height under the chin.
- **Truth landmarks.** They are lifted from a straight-on photo of the truth by MediaPipe, then
  ray-cast onto it. They only bound where the profile is searched and seed the alignment.

### Caveats

- **The skull alignment can pitch by about 2°.** A near-round cranium pins pitch about the ear
  axis only weakly, and two different skulls' best surface fit is not their anatomical match.
  - On mpfb-1 (five photos), the ICP and a vertex-for-vertex skull similarity differ by 2.3° of
    pitch and 0.4 % of scale. The vertex-for-vertex similarity is possible only because the
    topology is shared.
  - Under the vertex-for-vertex alignment, glabella and nasion move by at most 0.3 mm. midBridge,
    pogonion and menton move by 1.9–3.2 mm.
  - For MPFB heads, `report.json` gives that comparison and the points under the vertex alignment
    as `exact`.
- **Rocketbox heads model their hair** as part of the head mesh: ponytails, a helmet of short
  hair. The truth's skull cloud, outlines and widths use only bare skin, classified from the head's
  texture.
  - f01 keeps 86 cloud points, mostly the ears; mpfb-1 keeps 2761.
  - Such heads rest their alignment on the ears and the face start. `skullPoints` in each report
    says how much skull there was.
- **LPS has no real size.** Its scale is a guess, so its scale check is not scored (`·`).
- **Some checks need a person's eye** and are marked `·`: whether the forehead not reading as skin
  is a fringe, and a hair class where the head's label is unset.
