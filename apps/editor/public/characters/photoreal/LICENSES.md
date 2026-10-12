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
