// Runs in the browser page gen-face-points.ts opens: loads each character,
// draws its head's front view exactly as the face swap does, and finds its
// face landmarks there with MediaPipe.
import { FaceLandmarker } from '@mediapipe/tasks-vision'
import type { Mesh, MeshStandardMaterial, Texture } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FACE_POINT_INDICES, packPoints } from '../../packages/editor/src/components/editor/first-person/face-points'
import { FRONT } from '../../packages/editor/src/components/editor/first-person/face-swap'
import { renderFront } from '../../packages/editor/src/components/editor/first-person/front-render'
import { headGeometry } from '../../packages/editor/src/components/editor/first-person/head-geometry'
import type { Pixels } from '../../packages/editor/src/components/editor/first-person/look-pixels'

function pixelsOf(texture: Texture): Pixels {
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/** The front view on a grey ground (as a photo would have one), as a canvas. */
function canvasOf(front: Pixels) {
  const canvas = document.createElement('canvas')
  canvas.width = front.width
  canvas.height = front.height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#9a9a9a'
  context.fillRect(0, 0, front.width, front.height)
  const layer = document.createElement('canvas')
  layer.width = front.width
  layer.height = front.height
  layer.getContext('2d')!.putImageData(new ImageData(front.data, front.width, front.height), 0, 0)
  context.drawImage(layer, 0, 0)
  return canvas
}

type Found = { id: string; points: number[] | null; yaw: number; preview: string }

async function run(ids: string[]): Promise<Found[]> {
  const landmarker = await FaceLandmarker.createFromOptions(
    {
      wasmLoaderPath: '/mediapipe/vision_wasm_internal.js',
      wasmBinaryPath: '/mediapipe/vision_wasm_internal.wasm',
    },
    {
      baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    },
  )
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const found: Found[] = []
  for (const id of ids) {
    const gltf = await loader.loadAsync(`/characters/rocketbox/${id}.glb`)
    let head: Mesh | null = null
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.isMesh && /_head$/.test((mesh.material as MeshStandardMaterial).name)) head = mesh
    })
    if (!head) {
      found.push({ id, points: null, yaw: 0, preview: '' })
      continue
    }
    const mesh = head as Mesh
    const geometry = headGeometry(mesh)
    const texture = pixelsOf((mesh.material as MeshStandardMaterial).map!)
    const front = renderFront(texture, geometry.all, FRONT)
    const canvas = canvasOf(front.image)
    const result = landmarker.detect(canvas)
    const landmarks = result.faceLandmarks[0]
    const matrix = result.facialTransformationMatrixes?.[0]?.data
    const yaw = matrix ? (Math.asin(Math.max(-1, Math.min(1, -matrix[2]!))) * 180) / Math.PI : 0
    const context = canvas.getContext('2d')!
    context.fillStyle = '#00e5ff'
    if (landmarks) {
      for (const index of FACE_POINT_INDICES) {
        const point = landmarks[index]!
        context.fillRect(point.x * FRONT - 2, point.y * FRONT - 2, 4, 4)
      }
    }
    found.push({
      id,
      points: landmarks
        ? packPoints(FACE_POINT_INDICES.map((index) => [landmarks[index]!.x, landmarks[index]!.y]))
        : null,
      yaw,
      preview: canvas.toDataURL('image/jpeg', 0.7),
    })
  }
  landmarker.close()
  return found
}

;(window as unknown as { facePoints: typeof run }).facePoints = run
