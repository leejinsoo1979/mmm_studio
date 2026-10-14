import type { AvatarGender } from '../avatar-catalog'
import { type BaseBody, type BaseMeta, readBaseBody } from './base-body'
import { type Expression, type ExpressionIndex, readExpressions } from './expressions'
import { type FaceTargetIndex, type LandmarkMap, readFaceTargets } from './head-model'

/** Where the app serves the base bodies a face is fitted to, and their fitting data. */
export const PHOTO_BASE_URL = '/characters/photoreal'

export const baseFileUrls = (gender: AvatarGender, root = PHOTO_BASE_URL) => ({
  glb: `${root}/mpfb-base-${gender}.glb`,
  meta: `${root}/mpfb-base-${gender}.json`,
  basemesh: `${root}/mpfb-base-${gender}.basemesh.bin`,
  landmarks: `${root}/mpfb-base-${gender}.landmarks.json`,
  targetIndex: `${root}/mpfb-face-targets.json`,
  targetData: `${root}/mpfb-face-targets.bin`,
  shapeIndex: `${root}/mpfb-head-shapes-${gender}.json`,
  shapeData: `${root}/mpfb-head-shapes-${gender}.bin`,
  expressionIndex: `${root}/mpfb-face-expressions.json`,
  expressionData: `${root}/mpfb-face-expressions.bin`,
})

const loaded = new Map<string, Promise<BaseBody>>()
const expressionsLoaded = new Map<string, Promise<Expression[]>>()

async function fetched(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response
}

/** The face's expressions on the base mesh (both genders share them), read once per page or worker. */
export function loadBaseExpressions(
  root = PHOTO_BASE_URL,
  fetcher: typeof fetch = fetch,
): Promise<Expression[]> {
  let found = expressionsLoaded.get(root)
  if (!found) {
    const urls = baseFileUrls('male', root)
    found = Promise.all([
      fetched(urls.expressionIndex, fetcher).then((r) => r.json() as Promise<ExpressionIndex>),
      fetched(urls.expressionData, fetcher).then((r) => r.arrayBuffer()),
    ]).then(([index, data]) => readExpressions(index, data))
    found.catch(() => expressionsLoaded.delete(root))
    expressionsLoaded.set(root, found)
  }
  return found
}

/** A base body read once per page (or worker) and gender. */
export function loadBaseBody(
  gender: AvatarGender,
  root = PHOTO_BASE_URL,
  fetcher: typeof fetch = fetch,
): Promise<BaseBody> {
  const key = `${root}|${gender}`
  let found = loaded.get(key)
  if (!found) {
    const urls = baseFileUrls(gender, root)
    const get = (url: string) => fetched(url, fetcher)
    found = (async () => {
      const [glb, meta, basemesh, landmarks, index, data, shapeIndex, shapeData] =
        await Promise.all([
          get(urls.glb).then((r) => r.arrayBuffer()),
          get(urls.meta).then((r) => r.json() as Promise<BaseMeta>),
          get(urls.basemesh).then((r) => r.arrayBuffer()),
          get(urls.landmarks).then((r) => r.json() as Promise<LandmarkMap>),
          get(urls.targetIndex).then((r) => r.json() as Promise<FaceTargetIndex>),
          get(urls.targetData).then((r) => r.arrayBuffer()),
          get(urls.shapeIndex).then((r) => r.json() as Promise<FaceTargetIndex>),
          get(urls.shapeData).then((r) => r.arrayBuffer()),
        ])
      return readBaseBody({
        glb,
        meta,
        basemesh,
        landmarks,
        targets: [...readFaceTargets(index, data), ...readFaceTargets(shapeIndex, shapeData)],
      })
    })()
    found.catch(() => loaded.delete(key))
    loaded.set(key, found)
  }
  return found
}
