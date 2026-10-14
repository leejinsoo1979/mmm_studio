# 실사 (photoreal) characters — licences

Characters in this folder are shipped with the app, so each one's licence
allows redistribution and commercial use. Characters whose terms don't
(MetaHuman, Character Creator, Avaturn, Avatar SDK and similar exports) are
never committed: they go in `../photoreal-local/` (ignored by git; see its
README).

## makehuman-female-01.glb, thumbs/makehuman-female-01.webp

- What: a full-body female made with MakeHuman's MPFB Blender extension
  (67-bone Mixamo-style rig, ponytail hair cards, T-shirt and jeans).
- Source: `avatars/mpfb.glb` in https://github.com/met4citizen/TalkingHead
  (README, "Licenses": "created using Blender and MPFB … licensed under CC0").
  Source file sha256 `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`
  (36.8 MB), fetched 2026-10-12.
- Licence: CC0 1.0 (public domain dedication),
  https://creativecommons.org/publicdomain/zero/1.0/ — MakeHuman's assets
  are CC0 too. No attribution required; credited anyway.
- Changes: built with `scripts/characters/build-photoreal-character.mjs`:
  only the `eyeBlinkLeft`/`eyeBlinkRight` blend shapes kept (of 66), skin
  texture kept at 2048, clothing and hair at 1024, eyes 512, mouth 256, all
  WebP (quality 88), geometry meshopt-compressed — 1.72 MB. The thumbnail is
  a render of it in the character studio's lighting.

## mpfb-base-male.glb, mpfb-base-female.glb, thumbs/mpfb-base-*.webp, mpfb-base-*.json, mpfb-base-*.basemesh.bin, mpfb-face-targets.bin/.json

- What: the base bodies a face photo is fitted onto (실사 남/여 기본형): an
  adult man and woman made from MakeHuman's base mesh, targets and system
  assets — a 54-bone Mixamo-named rig (MPFB's 52 plus `LeftEye`/`RightEye`),
  eyes with separate sclera, iris and clear cornea, brows, lashes, teeth,
  tongue, hair cards, an outfit, `eyeBlinkLeft`/`eyeBlinkRight` blend shapes,
  and the head on its own UV layout and textures. The `.json` files say how
  a face fitting drives them (head UV layout, vertex attributes, morphs,
  bones), `.basemesh.bin` their base mesh at rest, and `mpfb-face-targets.*`
  are MakeHuman's 290 face targets, compact.
- Sources:
  - MPFB2, https://github.com/makehumancommunity/mpfb2 (git clone, v2.0.18,
    commit `d0a32e57`): the base mesh, macro and face targets, the
    expression units the blinks are made from, the Mixamo rig and weights,
    the `face_solid` UV layer and the lips/mouth/eyelid masks. Its
    LICENSE.md, section C: these assets are released under CC0 1.0.
  - MakeHuman 1.1.1's system assets, from Ubuntu's
    `makehuman-data_1.1.1-1_all.deb` (archive.ubuntu.com, pool
    universe/m/makehuman; sha256
    `881a79c3a6640e2ecc579093f6895d161fd902856504b123ef750e843f4304a7`,
    fetched 2026-10-13): eyes `high-poly` with the `brown` texture,
    eyebrows `eyebrow001`/`eyebrow006`, eyelashes `eyelashes01`/`02`,
    `teeth_base`, `tongue01`, hair `short02`/`ponytail01`, clothes
    `male_casualsuit01`, `female_casualsuit01`, `shoes01`, `shoes02`, skins
    `young_lightskinned_male_diffuse3`/`female_diffuse3`. MakeHuman's
    LICENSE.md (https://github.com/makehumancommunity/makehuman), section
    C: the bundled assets — base mesh, proxies, targets, textures, clothes
    — are released under CC0 1.0; the 1.1.1 package's own terms already
    put characters exported from them under CC0.
- Licence: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/. No
  attribution required; credited anyway.
- Changes: built with `scripts/characters/build-mpfb-base.py` (Blender as a
  Python module, MPFB2), then `scripts/characters/build-photoreal-character.mjs`.
  The MakeHuman logo on the women's T-shirt is painted over (MakeHuman's
  trade mark isn't ours to use); the brown iris is tinted a darker brown
  and the ponytail darkened; the head is redrawn into its own 2048 layout
  with a normal map from its colour's fine detail and a roughness map from
  MPFB's lip, mouth and eyelid masks; the skin under the clothes, and the
  socks under the jeans, are removed. The thumbnails are renders in the
  character studio's lighting.

## mpfb-face-expressions.bin, mpfb-face-expressions.json

- What: 28 face expression shapes for photo avatars, named as ARKit blend
  shapes (eyeBlink, eyeSquint, eyeWide, browDown, browInnerUp,
  browOuterUp, jawOpen, mouthSmile, mouthFrown, mouthStretch,
  mouthUpperUp, mouthLowerDown, mouthPress, mouthPucker, mouthFunnel,
  noseSneer; left and right where a face has two): per shape, the base
  mesh vertices it moves (skin, and the helpers the brows, lashes, teeth
  and tongue are bound to) and their deltas.
- Source: MPFB2, https://github.com/makehumancommunity/mpfb2 (git clone,
  v2.0.18, commit `d0a32e57`), `src/mpfb/data/targets/expression/units/`
  (african, asian and caucasian), mixed by race as the base bodies are
  (asian 0.6, caucasian 0.3, african 0.1). Its LICENSE.md, section C:
  CC0 1.0.
- Licence: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/. No
  attribution required; credited anyway.
- Changes: built with `scripts/characters/build-mpfb-expressions.py`: each
  shape one unit or a sum of units, split into the face's halves where
  ARKit has a side (blended over 1 cm at the middle), the tongue carried
  rigidly with the lower teeth where a shape moves them (MakeHuman's
  mouth-open leaves it behind), deltas in 0.01 mm steps. sha256: `.bin`
  `c7599b41905ee9b6d9cad83434631d74fe8f3ccea281928e64fb43abb3277d44`,
  `.json` `9df5e2a908567b938e734fa522ae28b497d5114854f0164072bf5b53705fbdfc`.

## mpfb-base-male.landmarks.json, mpfb-base-female.landmarks.json

- What: where MediaPipe Face Landmarker's 478 face landmarks sit on each
  base body's skin (three base mesh vertices and weights per landmark), for
  fitting the head to photos (사진으로 실사 아바타).
- Source: made here from the base bodies above, by running MediaPipe Face
  Landmarker (Apache 2.0, `../../mediapipe/`) on renders of each head (front,
  and turned 14° each way) and looking every landmark up on the rendered
  skin. Only vertex indices and weights of the CC0 base mesh; no face data
  of any person.
- Licence: CC0 1.0, as the base bodies.

## mpfb-head-shapes-male.bin/.json, mpfb-head-shapes-female.bin/.json

- What: the principal shapes of MakeHuman heads, for fitting a head to
  photos (사진으로 실사 아바타): 300 adult bodies per base, their macro
  sliders (age, weight, muscle, height, proportions, African / Asian /
  Caucasian mix) drawn at random, each head put on the base body's head by a
  similarity, and the main directions of how they differ kept (12 for the
  man, 11 for the woman; 99.5 % of the differences), each scaled to one
  standard deviation. They move the skull, the ears and the face together,
  as people's heads differ. Same compact layout as `mpfb-face-targets.*`.
- Source: MPFB2, https://github.com/makehumancommunity/mpfb2 (v2.0.18,
  commit `d0a32e57`): its base mesh and macro targets, through Blender as a
  Python module. Made by `scripts/photo-avatar/make-head-shapes.py --count
  300 --seed 1` and `scripts/photo-avatar/head-shapes.py --most 12 --keep
  0.995`. sha256: male `.bin` `897a1878bbd49b75069c4525f4dad16ab25b13184000473e5c6b1b85274cb22b`,
  female `.bin` `32bd85cfb2e2f8262f154980ce104ff1607484950e78c09b9829763e2ac4b23a`.
- Licence: CC0 1.0, as MPFB2's assets (its LICENSE.md, section C). No face
  data of any person.

## hair/ (photo avatars' hair: `<style>.bin`, `<style>.webp`, `cap.webp`, `buzz.webp`, `styles.json`)

- What: the hair a photo avatar is given, matched to its photos (사진으로 실사
  아바타): MakeHuman's hair proxies `short02`, `short03`, `bob02`, `long01`,
  `ponytail01` and `afro01`, each bound to MakeHuman's base mesh as
  MakeHuman binds a proxy (three base mesh vertices, weights and an offset
  per hair vertex) so it fits whichever base body and face it is put on,
  with a cap under its cards and a hairline tint for the scalp;
  `long01-bob` and `long01-shoulder`, long01 cut at the jaw and at the
  shoulders (they share `long01.webp`); and a buzz cut (`buzz`), made here:
  a stubble shell on the scalp.
- Source: MakeHuman 1.1.1's system assets, from Ubuntu's
  `makehuman-data_1.1.1-1_all.deb` (archive.ubuntu.com, pool
  universe/m/makehuman; sha256
  `881a79c3a6640e2ecc579093f6895d161fd902856504b123ef750e843f4304a7`, fetched
  2026-10-13), `usr/share/makehuman/data/hair/<style>/` — the `.mhclo`
  binding, the `.npz` mesh and the `_diffuse.png` picture of each. Their
  sha256 (first 16 hex): short02 mhclo `e379e5a370c4a61a`, npz
  `5f489c4abe660150`, png `d668e8e413749136`; short03 `4c618b130e2f045e`,
  `d44c62eae75b352e`, `595bdc8553609dfd`; bob02 `5142ba1bd04d7f40`,
  `c0fc3ed9996e3dcb`, `2d2aafeac59079bc`; long01 `e9dc110dcc59a2bd`,
  `d46e870d6924f0be`, `6bc78727a34e159f`; ponytail01 `3b911fa4cc4fbb35`,
  `e147a61f336fb8eb`, `313a0a59b05245e6`; afro01 `7ab4f15afcf53b4a`,
  `141059ce5266be10`, `e1dee945acd35c10`. The skin weights come from MPFB2's
  Mixamo rig (`data/rigs/standard/weights.mixamo.json`, git clone, v2.0.18,
  `d0a32e57`), the base mesh's faces from MPFB2's `data/3dobjs/base.obj`.
- Licence: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/.
  MakeHuman's LICENSE.md (https://github.com/makehumancommunity/makehuman,
  git clone, `a8bc2d54`), section C: the bundled assets — "the base mesh and
  proxies … textures … clothes (any MHCLO-based asset)" — are released under
  CC0 1.0 (the 1.1.1 package still carries the old AGPL header in each file;
  the project's licence statement supersedes it for assets). MPFB2's
  LICENSE.md, section C: its data is CC0 1.0. The cap, buzz and stubble
  pictures are made by the script from noise: CC0 1.0 as the rest. No
  attribution required; credited anyway.
- Changes: built with `scripts/characters/build-photo-hair.py` (numpy and
  Pillow): each picture resized to 1024, its colour turned to one neutral
  brown (the strands' light kept, its brightest highlights rolled off) so a
  photo's hair colour can be toned from it; the short styles' strands past
  the nape pressed up into a 1 cm taper, thinning out down it; long01's
  cards cut straight across 11 cm under the eyes for `long01-bob` and 26 cm
  under them for `long01-shoulder`, thinning out over the last 2.5 cm; every
  style's strands thinning out over the last 1.2 cm to their hairline (a
  per-vertex alpha); WebP quality 88 with alpha.
