'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  FogExp2,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicNodeMaterial,
  LineSegments,
  Matrix4,
  MeshBasicNodeMaterial,
} from 'three/webgpu'
import { GRID_LAYER } from '../../lib/layers'
import { getSceneTheme } from '../../lib/scene-themes'
import { getSolarPosition } from '../../lib/solar-position'
import { OVERCAST_SKY, WEATHER_LOOKS } from '../../lib/weather'
import useViewer from '../../store/use-viewer'

/** Rain and snow fill a box this wide (m, each way) and tall around the camera. */
const FIELD_RADIUS = 16
const FIELD_HEIGHT = 14
const RAIN_DROPS = 3500
const RAIN_SPEED = 9
const RAIN_STREAK = 0.5
const SNOW_FLAKES = 1800
const SNOW_SPEED = 0.9
/** How often (s) the dry area under the building is re-measured. */
const SHELTER_REFRESH = 2

const NIGHT_SKY = new Color('#080d19')
const OVERCAST = new Color(OVERCAST_SKY)
const fogColor = new Color()

/**
 * The sky's weather: fog that thickens with it, and rain or snow falling in a
 * box that follows the camera — kept out from under the building's roof, so
 * a walk indoors stays dry while the windows show the weather. Light and sky
 * colour follow the same `WEATHER_LOOKS` in `Lights` and the background.
 */
export function WeatherSystem() {
  const weather = useViewer((state) => state.weather)
  const fall = WEATHER_LOOKS[weather].fall
  const scene = useThree((state) => state.scene)
  const densityRef = useRef(0)

  useEffect(
    () => () => {
      scene.fog = null
    },
    [scene],
  )

  useFrame((_, delta) => {
    const viewer = useViewer.getState()
    const look = WEATHER_LOOKS[viewer.weather]
    const step = 1 - Math.exp(-Math.min(delta, 0.1) * 2)
    densityRef.current += (look.fog - densityRef.current) * step
    if (densityRef.current < 0.0005) {
      if (scene.fog) scene.fog = null
      return
    }
    if (!(scene.fog instanceof FogExp2)) scene.fog = new FogExp2('#ffffff', 0)
    // The fog takes the sky's colour, as the background does.
    const { daylight } = getSolarPosition(viewer.sunTime, viewer.sunMonth, viewer.sunAzimuth)
    fogColor
      .set(getSceneTheme(viewer.sceneTheme).background)
      .lerp(OVERCAST, look.overcast)
      .lerp(NIGHT_SKY, 1 - daylight)
    scene.fog.color.copy(fogColor)
    scene.fog.density = densityRef.current
  })

  if (fall === 'rain') return <Rain />
  if (fall === 'snow') return <Snow />
  return null
}

/** The building's footprint and top, under which nothing falls. */
function useShelter() {
  const box = useRef(new Box3())
  const age = useRef(Number.POSITIVE_INFINITY)
  return (delta: number) => {
    age.current += delta
    if (age.current < SHELTER_REFRESH) return box.current
    age.current = 0
    box.current.makeEmpty()
    for (const type of ['wall', 'roof', 'slab'] as const) {
      for (const id of sceneRegistry.byType[type] ?? []) {
        const object = sceneRegistry.nodes.get(id)
        if (object) box.current.expandByObject(object)
      }
    }
    return box.current
  }
}

const sheltered = (box: Box3, x: number, y: number, z: number) =>
  !box.isEmpty() &&
  x > box.min.x &&
  x < box.max.x &&
  z > box.min.z &&
  z < box.max.z &&
  y < box.max.y + 0.2

/** A drop's spot in the field: anywhere around the camera, somewhere above it. */
function respawn(out: Float32Array, i: number, cx: number, cy: number, cz: number, top: boolean) {
  out[i * 3] = cx + (Math.random() * 2 - 1) * FIELD_RADIUS
  out[i * 3 + 1] = top
    ? cy + FIELD_HEIGHT * (0.6 + Math.random() * 0.4)
    : cy + Math.random() * FIELD_HEIGHT
  out[i * 3 + 2] = cz + (Math.random() * 2 - 1) * FIELD_RADIUS
}

/** Keeps a drop inside the field as the camera moves: it re-enters on the far side. */
function wrap(value: number, centre: number) {
  if (value < centre - FIELD_RADIUS) return value + FIELD_RADIUS * 2
  if (value > centre + FIELD_RADIUS) return value - FIELD_RADIUS * 2
  return value
}

function Rain() {
  const camera = useThree((state) => state.camera)
  const shelter = useShelter()
  const drops = useMemo(() => new Float32Array(RAIN_DROPS * 3), [])
  const seeded = useRef(false)
  const lines = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(RAIN_DROPS * 6), 3))
    const material = new LineBasicNodeMaterial({
      color: '#c4ced9',
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    const segments = new LineSegments(geometry, material)
    segments.frustumCulled = false
    segments.layers.set(GRID_LAYER)
    return segments
  }, [])

  useEffect(
    () => () => {
      lines.geometry.dispose()
      ;(lines.material as LineBasicNodeMaterial).dispose()
    },
    [lines],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const { x: cx, y: cy, z: cz } = camera.position
    const box = shelter(dt)
    if (!seeded.current) {
      for (let i = 0; i < RAIN_DROPS; i++) respawn(drops, i, cx, cy, cz, false)
      seeded.current = true
    }
    const position = lines.geometry.getAttribute('position') as BufferAttribute
    const out = position.array as Float32Array
    const floor = Math.min(0, cy - FIELD_HEIGHT * 0.5)
    for (let i = 0; i < RAIN_DROPS; i++) {
      let x = wrap(drops[i * 3]!, cx)
      let y = drops[i * 3 + 1]! - RAIN_SPEED * dt
      let z = wrap(drops[i * 3 + 2]!, cz)
      if (y < floor) {
        respawn(drops, i, cx, cy, cz, true)
        x = drops[i * 3]!
        y = drops[i * 3 + 1]!
        z = drops[i * 3 + 2]!
      }
      drops[i * 3] = x
      drops[i * 3 + 1] = y
      drops[i * 3 + 2] = z
      // Under the roof a drop is folded to nothing (both ends on one point).
      const length = sheltered(box, x, y, z) ? 0 : RAIN_STREAK
      const o = i * 6
      out[o] = x
      out[o + 1] = y
      out[o + 2] = z
      out[o + 3] = x
      out[o + 4] = y + length
      out[o + 5] = z
    }
    position.needsUpdate = true
  })

  return <primitive object={lines} />
}

function Snow() {
  const camera = useThree((state) => state.camera)
  const shelter = useShelter()
  const flakes = useMemo(() => new Float32Array(SNOW_FLAKES * 3), [])
  const seeded = useRef(false)
  const time = useRef(0)
  const matrix = useMemo(() => new Matrix4(), [])
  const mesh = useMemo(() => {
    const instanced = new InstancedMesh(
      new IcosahedronGeometry(0.025, 0),
      new MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
      SNOW_FLAKES,
    )
    instanced.frustumCulled = false
    instanced.layers.set(GRID_LAYER)
    return instanced
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicNodeMaterial).dispose()
    },
    [mesh],
  )

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    time.current += dt
    const { x: cx, y: cy, z: cz } = camera.position
    const box = shelter(dt)
    if (!seeded.current) {
      for (let i = 0; i < SNOW_FLAKES; i++) respawn(flakes, i, cx, cy, cz, false)
      seeded.current = true
    }
    const floor = Math.min(0, cy - FIELD_HEIGHT * 0.5)
    for (let i = 0; i < SNOW_FLAKES; i++) {
      // Each flake drifts on its own slow sway.
      const sway = Math.sin(time.current * 0.8 + i) * 0.35 * dt
      let x = wrap(flakes[i * 3]! + sway, cx)
      let y = flakes[i * 3 + 1]! - SNOW_SPEED * dt
      let z = wrap(flakes[i * 3 + 2]! + Math.cos(time.current * 0.6 + i * 1.7) * 0.25 * dt, cz)
      if (y < floor) {
        respawn(flakes, i, cx, cy, cz, true)
        x = flakes[i * 3]!
        y = flakes[i * 3 + 1]!
        z = flakes[i * 3 + 2]!
      }
      flakes[i * 3] = x
      flakes[i * 3 + 1] = y
      flakes[i * 3 + 2] = z
      const scale = sheltered(box, x, y, z) ? 0 : 1
      matrix.makeScale(scale, scale, scale).setPosition(x, y, z)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return <primitive object={mesh} />
}
