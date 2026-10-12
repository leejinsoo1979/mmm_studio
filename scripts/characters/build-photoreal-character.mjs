// Builds a 실사 (photoreal set) character for the editor's public characters
// folder from a rigged glTF/GLB: only the blend shapes the game plays kept,
// each texture at the size its part needs (WebP), geometry meshopt-packed.
//
//   node scripts/characters/build-photoreal-character.mjs <in.glb> <out.glb>
//
// Run it from a folder where @gltf-transform/core, @gltf-transform/extensions,
// @gltf-transform/functions, meshoptimizer and sharp are installed (they are
// looked up from the working directory, not this repo). Prints what it wrote.

import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(`${process.cwd()}/`)
const load = (name) => import(pathToFileURL(require.resolve(name)).href)

const { NodeIO } = await load('@gltf-transform/core')
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions')
const { dedup, meshopt, prune, textureCompress } = await load('@gltf-transform/functions')
const { MeshoptDecoder, MeshoptEncoder } = await load('meshoptimizer')
const sharp = (await load('sharp')).default

/** The blend shapes kept: the game blinks with them (photoreal-body.ts). */
const KEPT_TARGETS = new Set(['eyeBlinkLeft', 'eyeBlinkRight'])

/** Each texture's longest side, by its name; the first match wins. Skin keeps the most. */
const TEXTURE_SIZES = [
  [/skin|body|diffuse2$/i, 2048],
  [/eye/i, 512],
  [/teeth|tongue/i, 256],
  [/hair|ponytail|bob|braid/i, 1024],
  [/.*/, 1024],
]
const QUALITY = 88

const [input, output] = process.argv.slice(2)
if (!(input && output)) {
  console.error('usage: build-photoreal-character.mjs <in.glb> <out.glb>')
  process.exit(1)
}

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
})
const document = await io.read(resolve(input))
const root = document.getRoot()

for (const mesh of root.listMeshes()) {
  const names = mesh.getExtras()?.targetNames
  if (!Array.isArray(names) || names.length === 0) continue
  const keep = names.map((name) => KEPT_TARGETS.has(name))
  for (const primitive of mesh.listPrimitives()) {
    primitive.listTargets().forEach((target, index) => {
      if (!keep[index]) {
        primitive.removeTarget(target)
        target.dispose()
      }
    })
  }
  const weights = mesh.getWeights()
  mesh.setWeights(weights.filter((_, index) => keep[index]))
  mesh.setExtras({ ...mesh.getExtras(), targetNames: names.filter((_, index) => keep[index]) })
}

for (const texture of root.listTextures()) {
  const name = texture.getName() || texture.getURI()
  const size = TEXTURE_SIZES.find(([pattern]) => pattern.test(name))[1]
  const image = texture.getImage()
  if (!image) continue
  const { width, height } = await sharp(image).metadata()
  if (Math.max(width, height) <= size) continue
  const resized = await sharp(image)
    .resize({ width: size, height: size, fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer()
  texture.setImage(new Uint8Array(resized)).setMimeType('image/png')
}

await document.transform(
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: QUALITY }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
)
await io.write(resolve(output), document)

let triangles = 0
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()
    triangles += count / 3
  }
}
const textures = []
for (const texture of root.listTextures()) {
  const { width, height } = await sharp(texture.getImage()).metadata()
  textures.push({ name: texture.getName(), width, height, bytes: texture.getImage().byteLength })
}
console.log(JSON.stringify({ output, bytes: statSync(output).size, triangles, textures }, null, 1))
