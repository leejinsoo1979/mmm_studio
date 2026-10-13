// The bench's MPFB truth heads as files: each head make-mpfb-heads.py wrote (every base mesh vertex)
// built on the app's base body for its gender, as the photo avatars are, so its skin, eyes, teeth,
// hair and clothes follow it. Writes <cache>/mpfb-<seed>.glb and mpfb-<seed>-expression.glb.
//   bun scripts/photo-avatar/mpfb-truth.ts <cache> <seeds, e.g. 1,2>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBaseForTests } from '../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/base-for-tests'
import { buildAvatarGlb } from '../../packages/editor/src/components/editor/first-person/photo-avatar/base-body'

const [cache, seeds] = process.argv.slice(2)
if (!(cache && seeds)) throw new Error('usage: bun mpfb-truth.ts <cache> <seeds>')

for (const seed of seeds.split(',').map(Number)) {
  const meta = JSON.parse(readFileSync(join(cache, `mpfb-${seed}.json`), 'utf8')) as { gender: 'male' | 'female' }
  const base = await loadBaseForTests(meta.gender)
  for (const suffix of ['', '-expression']) {
    const bytes = readFileSync(join(cache, `mpfb-${seed}${suffix}.basemesh.bin`))
    const head = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    if (head.length !== base.basemesh.length) throw new Error(`seed ${seed}: not the base mesh's vertices`)
    const moves = new Float64Array(head.length)
    for (let i = 0; i < head.length; i++) moves[i] = head[i]! - base.basemesh[i]!
    const glb = buildAvatarGlb(base, moves, new Map(), { dropBrows: false })
    writeFileSync(join(cache, `mpfb-${seed}${suffix}.glb`), glb)
    console.log(`mpfb-${seed}${suffix}.glb`, glb.byteLength)
  }
}
