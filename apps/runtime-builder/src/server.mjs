import { createServer } from 'node:http'
import { access, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const runtimeDir = path.join(root, 'apps/runtime')
const port = Number(process.env.PORT || 8080)
const token = process.env.MMM_BUILDER_TOKEN
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'mmm-studio-7a14c.firebasestorage.app'

if (!token) throw new Error('MMM_BUILDER_TOKEN is required')

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), storageBucket: bucketName })
}

const firestore = getFirestore()
const bucket = getStorage().bucket()
let queue = Promise.resolve()
const artifacts = new Map()
const jobs = new Map()

async function setJob(jobId, data) {
  jobs.set(jobId, { ...(jobs.get(jobId) || {}), ...data })
  try {
    await firestore.collection('runtimeBuildJobs').doc(jobId).set(data, { merge: true })
  } catch (error) {
    console.warn('[runtime-builder] Firestore status persistence unavailable:', String(error))
  }
}

async function getJob(jobId) {
  try {
    const snapshot = await firestore.collection('runtimeBuildJobs').doc(jobId).get()
    if (snapshot.exists) return snapshot.data()
  } catch {}
  return jobs.get(jobId)
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  })
}

async function artifactFor(platform) {
  const files = await readdir(path.join(runtimeDir, 'dist'))
  const match = files.find((name) =>
    platform === 'macos'
      ? name.endsWith('-arm64.dmg')
      : name.endsWith('.exe') && !name.includes('Setup'),
  )
  if (!match) throw new Error(`No ${platform} artifact was generated`)
  const artifact = path.join(runtimeDir, 'dist', match)
  await access(artifact)
  return artifact
}

async function build(payload) {
  const { jobId, platform, scene, playUrl } = payload
  await setJob(jobId, {
    sceneId: scene.id,
    sceneName: scene.name,
    platform,
    quality: payload.quality,
    status: 'building',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  try {
    await run('node', ['scripts/configure-runtime.mjs', playUrl, scene.name], runtimeDir)
    await run('npm', ['run', platform === 'macos' ? 'build:mac' : 'build:windows'], runtimeDir)
    const artifact = await artifactFor(platform)
    const extension = path.extname(artifact)
    const safeSceneName = String(scene.name || 'MMM Studio Experience')
      .replace(/[\r\n"\\/]/g, '-')
      .slice(0, 120)
    const artifactName = `${safeSceneName}-${platform}${extension}`
    artifacts.set(jobId, { path: artifact, name: artifactName })
    let downloadUrl
    let storageError
    try {
      const destination = `runtime-builds/${scene.ownerId || 'published'}/${jobId}/${platform}${extension}`
      await bucket.upload(artifact, {
        destination,
        metadata: {
          contentDisposition: `attachment; filename="${artifactName}"`,
          metadata: { sceneId: scene.id, jobId, platform },
        },
      })
      const file = bucket.file(destination)
      ;[downloadUrl] = await file.getSignedUrl({ action: 'read', expires: '2500-01-01' })
    } catch (error) {
      storageError = String(error)
    }
    await setJob(
      jobId,
      {
        status: 'complete',
        artifactReady: true,
        artifactName,
        ...(downloadUrl ? { downloadUrl } : {}),
        ...(storageError ? { storageError } : {}),
        updatedAt: new Date().toISOString(),
      },
    )
    return { jobId, status: 'complete', downloadUrl, artifactReady: true }
  } catch (error) {
    await setJob(
      jobId,
      { status: 'failed', error: String(error), updatedAt: new Date().toISOString() },
    )
    throw error
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ok: true, platform: process.platform })
    return
  }
  if (request.method === 'GET' && request.url?.match(/^\/jobs\/[^/]+\/artifact$/)) {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: 'unauthorized' })
      return
    }
    const jobId = decodeURIComponent(request.url.split('/')[2] || '')
    const artifact = artifacts.get(jobId)
    if (!artifact) {
      json(response, 404, { error: 'artifact_not_found' })
      return
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
    })
    import('node:fs').then(({ createReadStream }) => createReadStream(artifact.path).pipe(response))
    return
  }
  if (request.method === 'GET' && request.url?.startsWith('/jobs/')) {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: 'unauthorized' })
      return
    }
    const jobId = decodeURIComponent(request.url.slice('/jobs/'.length))
    void getJob(jobId)
      .then((job) =>
        job
          ? json(response, 200, { jobId, ...job })
          : json(response, 404, { error: 'not_found' }),
      )
      .catch((error) => json(response, 500, { error: String(error) }))
    return
  }
  if (request.method !== 'POST' || request.url !== '/jobs') {
    json(response, 404, { error: 'not_found' })
    return
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    json(response, 401, { error: 'unauthorized' })
    return
  }
  let raw = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    raw += chunk
    if (raw.length > 50_000_000) request.destroy()
  })
  request.on('end', () => {
    try {
      const payload = JSON.parse(raw)
      if (
        !payload.jobId ||
        (payload.platform !== 'macos' && payload.platform !== 'windows') ||
        !payload.scene?.id ||
        !payload.playUrl ||
        !URL.canParse(payload.playUrl)
      ) {
        json(response, 400, { error: 'invalid_request' })
        return
      }
      void setJob(payload.jobId, {
        sceneId: payload.scene.id,
        sceneName: payload.scene.name,
        platform: payload.platform,
        quality: payload.quality,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      const task = queue.then(() => build(payload))
      queue = task.catch(() => {})
      json(response, 202, { jobId: payload.jobId, status: 'queued' })
    } catch {
      json(response, 400, { error: 'invalid_json' })
    }
  })
}).listen(port, () => {
  console.log(`MMM runtime builder listening on :${port}`)
})
