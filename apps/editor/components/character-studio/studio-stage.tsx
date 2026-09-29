'use client'

import {
  type AvatarLook,
  type EmoteCue,
  EmoteLayer,
  type FaceLandmarks,
  findAvatar,
  headLandmarks,
  renderHeadFront,
  useAvatarBody,
  useAvatarLook,
  useEmoteClips,
} from '@pascal-app/editor'
import { ContactShadows } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { AnimationMixer, type Group, NeutralToneMapping, Vector3 } from 'three'

export type CameraFocus = 'full' | 'upper' | 'face'

/** The body's own face, front on, and where its eyes and mouth are on it. */
export type HeadFront = { image: string; landmarks: FaceLandmarks | null }

/**
 * Framing per focus, as fractions of the body's height: where the camera
 * looks and how much of the body the view holds top to bottom.
 */
const FRAMING: Record<CameraFocus, { look: number; span: number }> = {
  full: { look: 0.47, span: 1.55 },
  upper: { look: 0.76, span: 0.62 },
  face: { look: 0.9, span: 0.27 },
}

const FOV = 28
/** A Rocketbox body stands about 1.95 of its hip height tall. */
const HEIGHT_PER_HIP = 1.95

const lookTarget = new Vector3()
const lookCurrent = new Vector3()
const cameraTarget = new Vector3()

/** Eases the camera to the focus's framing, straight in front of the body. */
function CameraRig({ focus, zoom, hip }: { focus: CameraFocus; zoom: number; hip: number }) {
  const camera = useThree((state) => state.camera)
  const started = useRef(false)
  useFrame((_, delta) => {
    const height = hip * HEIGHT_PER_HIP
    const { look, span } = FRAMING[focus]
    const distance = ((height * span) / 2 / Math.tan(((FOV / 2) * Math.PI) / 180)) * zoom
    lookTarget.set(0, height * look, 0)
    const t = started.current ? 1 - Math.exp(-delta * 6) : 1
    started.current = true
    lookCurrent.lerp(lookTarget, t)
    camera.position.lerp(cameraTarget.set(0, lookCurrent.y + distance * 0.04, distance), t)
    camera.lookAt(lookCurrent)
  })
  return null
}

function StudioAvatar({
  avatarId,
  look,
  cue,
  yaw,
  onCueEnd,
  onHeadFront,
}: {
  avatarId: string
  look: AvatarLook
  cue: EmoteCue | null
  yaw: { current: number }
  onCueEnd: () => void
  onHeadFront: (front: HeadFront | null) => void
}) {
  const { avatar, model, clips } = useAvatarBody(avatarId)
  useAvatarLook(model, look)
  const emoteClips = useEmoteClips(avatar, true)
  const groupRef = useRef<Group>(null)
  const cueRef = useRef(cue)
  cueRef.current = cue
  const endRef = useRef(onCueEnd)
  endRef.current = onCueEnd

  const mixer = useMemo(() => new AnimationMixer(model), [model])
  const layer = useMemo(() => new EmoteLayer(mixer), [mixer])
  useEffect(() => layer.setClips(emoteClips), [layer, emoteClips])
  useEffect(() => {
    const idle = clips.find((clip) => clip.name === 'idle')
    if (!idle) return
    mixer.clipAction(idle).play()
    return () => {
      mixer.stopAllAction()
    }
  }, [clips, mixer])

  // The front view the face photo is placed on (the body's own face).
  useEffect(() => {
    const canvas = renderHeadFront(model, 512)
    onHeadFront(
      canvas ? { image: canvas.toDataURL('image/png'), landmarks: headLandmarks(model) } : null,
    )
  }, [model, onHeadFront])

  useFrame((_, delta) => {
    const weight = layer.update(cueRef.current, false, delta)
    const idle = clips.find((clip) => clip.name === 'idle')
    if (idle) mixer.clipAction(idle).setEffectiveWeight(1 - weight)
    if (cueRef.current && layer.finished(cueRef.current)) endRef.current()
    mixer.update(delta)
    if (groupRef.current) {
      groupRef.current.rotation.y += (yaw.current - groupRef.current.rotation.y) * 0.25
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  )
}

/** A soft white disc the character stands on, ringed in light blue. */
function Platform() {
  return (
    <group rotation-x={-Math.PI / 2}>
      <mesh receiveShadow>
        <circleGeometry args={[0.95, 96]} />
        <meshStandardMaterial color="#f8f9fb" roughness={0.9} />
      </mesh>
      <mesh position-z={0.001}>
        <ringGeometry args={[0.95, 0.975, 128]} />
        <meshBasicMaterial color="#bcd6f2" toneMapped={false} />
      </mesh>
      <mesh position-z={0.0005}>
        <ringGeometry args={[1.05, 1.9, 128]} />
        <meshBasicMaterial color="#ffffff" opacity={0.35} toneMapped={false} transparent />
      </mesh>
    </group>
  )
}

/**
 * The studio's 3D view: the character on a lit turntable, idling or playing
 * the emote being previewed, framed by `focus`. Dragging turns it (via
 * `yaw`), the wheel zooms.
 */
export function StudioStage({
  avatarId,
  look,
  cue,
  focus,
  zoom,
  yaw,
  onCueEnd,
  onHeadFront,
}: {
  avatarId: string
  look: AvatarLook
  cue: EmoteCue | null
  focus: CameraFocus
  zoom: number
  yaw: { current: number }
  onCueEnd: () => void
  onHeadFront: (front: HeadFront | null) => void
}) {
  const hip = findAvatar(avatarId).hip
  return (
    <Canvas
      camera={{ fov: FOV, near: 0.05, far: 50, position: [0, 1, 4] }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1.05
      }}
      shadows
    >
      <hemisphereLight args={['#ffffff', '#dfe4ec', 1.1]} />
      <directionalLight
        castShadow
        color="#fffaf3"
        intensity={2.4}
        position={[1.6, 3.2, 3]}
        shadow-bias={-0.0004}
        shadow-mapSize={[2048, 2048]}
        shadow-normalBias={0.02}
      />
      <directionalLight color="#e8f0ff" intensity={0.9} position={[-2.6, 1.8, 2.2]} />
      <directionalLight color="#dce8ff" intensity={1.6} position={[0, 2.6, -3.2]} />
      <Platform />
      <ContactShadows blur={2.6} far={2} opacity={0.35} position={[0, 0.002, 0]} scale={3} />
      <Suspense fallback={null}>
        <StudioAvatar
          avatarId={avatarId}
          cue={cue}
          look={look}
          onCueEnd={onCueEnd}
          onHeadFront={onHeadFront}
          yaw={yaw}
        />
      </Suspense>
      <CameraRig focus={focus} hip={hip} zoom={zoom} />
    </Canvas>
  )
}
