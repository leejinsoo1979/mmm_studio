import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The owner's own 실사 characters: the GLB files in
 * public/characters/photoreal-local (a folder the repository ignores, for
 * exports whose licence keeps them off a public site), with the name and
 * gender characters.json there gives each. The app serves the files
 * themselves from public/. A deployment without the folder lists none.
 */

export const dynamic = 'force-dynamic'

const FOLDER = join(process.cwd(), 'public', 'characters', 'photoreal-local')

type Entry = { file: string; name?: string; gender?: 'male' | 'female' }

async function namesFor(): Promise<Record<string, Omit<Entry, 'file'>>> {
  try {
    const parsed = JSON.parse(await readFile(join(FOLDER, 'characters.json'), 'utf8')) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, Omit<Entry, 'file'>>)
      : {}
  } catch {
    return {}
  }
}

export async function GET() {
  let files: string[] = []
  try {
    files = (await readdir(FOLDER)).filter((file) => /\.glb$/i.test(file)).sort()
  } catch {
    return Response.json({ characters: [] })
  }
  const names = await namesFor()
  const characters: Entry[] = files.map((file) => {
    const given = names[file] ?? {}
    return {
      file,
      ...(typeof given.name === 'string' ? { name: given.name.slice(0, 40) } : {}),
      ...(given.gender === 'male' || given.gender === 'female' ? { gender: given.gender } : {}),
    }
  })
  return Response.json({ characters })
}
