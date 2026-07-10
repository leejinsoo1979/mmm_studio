import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
} from 'three/webgpu'
import * as THREE from 'three/webgpu'
import { getSceneTheme } from '../../lib/scene-themes'
import { getSolarPosition } from '../../lib/solar-position'
import useViewer from '../../store/use-viewer'

// Diagnostic toggle: `?disable=shadows` skips the shadow-map render pass
// (which doubles draw calls for every shadow-casting mesh) so you can
// isolate how much of the baseline GPU cost is shadows vs. raw geometry.
const SHADOWS_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('shadows')

// Shadow darkness for the bright key lights (themes drive most lights past
// intensity 1). The aesthetic prototype runs these near-black (≈1.0); this is a
// deliberate middle ground — present, but not the heavy contact shadow there.
const MAX_SHADOW_INTENSITY = 0.55
const NIGHT_SUN_COLOR = new THREE.Color('#ff9a5a')
const NIGHT_SKY_COLOR = new THREE.Color('#18233d')
const NIGHT_GROUND_COLOR = new THREE.Color('#080b12')
const NIGHT_AMBIENT_COLOR = new THREE.Color('#26365c')

// Shadow frustum framing. The frustum is fit to the BUILDING geometry (not the
// camera): we union the bounds of all registered scene nodes, fit a sphere, and
// size the directional light's ortho shadow camera to that sphere plus a margin.
// This keeps shadows anchored to the building and a bit of surrounding ground no
// matter how the user zooms or pans — fixing the previous camera-following
// behaviour that fell apart when zoomed out (frustum too small) or zoomed into
// an empty corner (frustum centred on nothing).
//
// `site` nodes (the ground/site plane, which can be arbitrarily large) are
// excluded so they don't blow the frustum up to cover the whole lot.
const SHADOW_EXCLUDED_TYPES = ['site'] as const
// How often (seconds) to recompute building bounds. Bounds only change while
// editing, so we throttle the (subtree-walking) union instead of doing it every
// frame.
const BOUNDS_REFRESH_INTERVAL = 0.4
// Extra coverage around the building bounds — the "and a bit nearby" margin so
// shadows don't get clipped right at the walls. Scales with building size.
const SHADOW_MARGIN_SCALE = 1.15
const SHADOW_MARGIN = 3
// Gap between the building bounds sphere and the light / near plane.
const SHADOW_BACKOFF = 10
// Fallback radius when the scene has no building geometry yet (empty scene).
const SHADOW_FALLBACK_RADIUS = 30

export function Lights() {
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const theme = getSceneTheme(sceneTheme)
  const shadows = useViewer((state) => state.shadows)
  const shading = useViewer((state) => state.shading)
  const sunTime = useViewer((state) => state.sunTime)
  const sunMonth = useViewer((state) => state.sunMonth)
  const sunAzimuth = useViewer((state) => state.sunAzimuth)
  const solarPosition = useMemo(
    () => getSolarPosition(sunTime, sunMonth, sunAzimuth),
    [sunAzimuth, sunMonth, sunTime],
  )

  const lightRefs = useRef<Array<DirectionalLight | null>>([])
  const shadowCamera = useRef<OrthographicCamera>(null)
  // Initial ortho half-size; overridden each refresh to fit the building.
  const shadowCameraSize = 50

  // Building bounds the shadow frustum is fit to, recomputed on an interval.
  const shadowFocus = useRef(new THREE.Vector3()) // sphere centre
  const shadowRadius = useRef(SHADOW_FALLBACK_RADIUS) // sphere radius
  const shadowDir = useRef(new THREE.Vector3()) // scratch: per-light direction
  const boundsBox = useRef(new THREE.Box3()) // scratch: union AABB
  const boundsSphere = useRef(new THREE.Sphere()) // scratch: fitted sphere
  const lastBoundsTime = useRef(-1) // last refresh timestamp (-1 = never)

  const hemiRef = useRef<HemisphereLight>(null)
  const ambientRef = useRef<AmbientLight>(null)

  const initialized = useRef(false)
  const lightTargets = useRef<THREE.Color[]>([])

  const targets = useMemo(
    () => ({
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      ambColor: new THREE.Color(),
    }),
    [],
  )

  useFrame((state, delta) => {
    // clamp delta to avoid huge jumps on tab switch
    const dt = Math.min(delta, 0.1) * 4

    // Fit each shadow-casting light's frustum to the BUILDING geometry rather
    // than the camera. We refresh the union bounds on an interval (cheap enough,
    // and bounds only change while editing), fit a sphere, and size + place the
    // ortho shadow camera so the building (plus a margin) is fully covered from
    // the light's direction. Direction comes from the live solar controls;
    // position/distance and the frustum extents follow the fitted bounds.
    if (shadows) {
      const now = state.clock.elapsedTime
      if (now - lastBoundsTime.current >= BOUNDS_REFRESH_INTERVAL) {
        lastBoundsTime.current = now
        const box = boundsBox.current.makeEmpty()
        for (const [id, obj] of sceneRegistry.nodes) {
          if (SHADOW_EXCLUDED_TYPES.some((t) => sceneRegistry.byType[t]!.has(id))) continue
          box.expandByObject(obj)
        }
        box.getBoundingSphere(boundsSphere.current)
        const center = boundsSphere.current.center
        const radius = boundsSphere.current.radius
        // Empty scene OR a node with a NaN position/geometry poisoning the union
        // box: fall back to the origin with a default radius. The directional
        // light's position is derived from `focus`, so a single non-finite mesh
        // must NOT be allowed to make `focus`/`radius` NaN — that breaks every
        // shadow-casting light's position and renders the whole scene black.
        const finiteBounds =
          !box.isEmpty() &&
          Number.isFinite(center.x) &&
          Number.isFinite(center.y) &&
          Number.isFinite(center.z) &&
          Number.isFinite(radius)
        if (finiteBounds) {
          shadowFocus.current.copy(center)
          shadowRadius.current = radius
        } else {
          shadowFocus.current.set(0, 0, 0)
          shadowRadius.current = SHADOW_FALLBACK_RADIUS
        }
      }

      const focus = shadowFocus.current
      // Ortho half-extent: the building sphere plus a proportional margin.
      const size = shadowRadius.current * SHADOW_MARGIN_SCALE + SHADOW_MARGIN
      // Park the light just outside the sphere so the near plane stays positive
      // and the whole building fits between near and far along the light axis.
      const distance = size + SHADOW_BACKOFF
      const near = SHADOW_BACKOFF
      const far = distance + size

      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config?.castShadow && light)) continue
        const dir = shadowDir.current.copy(solarPosition.direction)
        if (dir.lengthSq() === 0) dir.set(0, 1, 0)
        dir.normalize().multiplyScalar(distance)
        light.position.set(focus.x + dir.x, focus.y + dir.y, focus.z + dir.z)
        light.target.position.copy(focus)
        light.target.updateMatrixWorld()

        // Resize the ortho frustum to the fitted bounds. The shadow camera is
        // the <orthographicCamera attach="shadow-camera"> below.
        const cam = light.shadow?.camera as THREE.OrthographicCamera | undefined
        if (cam) {
          cam.left = -size
          cam.right = size
          cam.top = size
          cam.bottom = -size
          cam.near = near
          cam.far = far
          cam.updateProjectionMatrix()
        }
      }
    }

    if (!initialized.current) {
      for (let index = 0; index < theme.lights.length; index++) {
        const config = theme.lights[index]
        const light = lightRefs.current[index]
        if (!(config && light)) continue
        light.intensity = config.intensity
        light.color.set(config.color)

        if (config.castShadow && light.shadow) {
          light.shadow.intensity = config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY
        }
      }
      if (hemiRef.current && theme.hemi) {
        hemiRef.current.intensity = theme.hemi.intensity
        hemiRef.current.color.set(theme.hemi.sky)
        hemiRef.current.groundColor.set(theme.hemi.ground)
      }
      if (ambientRef.current) {
        ambientRef.current.intensity = theme.ambient.intensity
        ambientRef.current.color.set(theme.ambient.color)
      }
      initialized.current = true
      return
    }

    for (let index = 0; index < theme.lights.length; index++) {
      const config = theme.lights[index]
      const light = lightRefs.current[index]
      if (!(config && light)) continue

      const daylightScale = config.castShadow
        ? 0.03 + solarPosition.daylight * 0.97
        : 0.12 + solarPosition.daylight * 0.88
      light.intensity = THREE.MathUtils.lerp(light.intensity, config.intensity * daylightScale, dt)
      let target = lightTargets.current[index]
      if (!target) {
        target = new THREE.Color()
        lightTargets.current[index] = target
      }
      target.set(config.color)
      if (config.castShadow) {
        const horizonWarmth = 1 - THREE.MathUtils.smoothstep(solarPosition.elevation, 0, 0.5)
        target.lerp(NIGHT_SUN_COLOR, horizonWarmth * 0.55)
      }
      light.color.lerp(target, dt)

      if (config.castShadow && light.shadow) {
        if (light.shadow.intensity !== undefined) {
          light.shadow.intensity = THREE.MathUtils.lerp(
            light.shadow.intensity,
            config.intensity <= 1 ? config.intensity : MAX_SHADOW_INTENSITY,
            dt,
          )
        }
      }
    }

    if (hemiRef.current && theme.hemi) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        theme.hemi.intensity * (0.15 + solarPosition.daylight * 0.85),
        dt,
      )
      targets.hemiSky.set(theme.hemi.sky)
      targets.hemiSky.lerp(NIGHT_SKY_COLOR, 1 - solarPosition.daylight)
      hemiRef.current.color.lerp(targets.hemiSky, dt)
      targets.hemiGround.set(theme.hemi.ground)
      targets.hemiGround.lerp(NIGHT_GROUND_COLOR, 1 - solarPosition.daylight)
      hemiRef.current.groundColor.lerp(targets.hemiGround, dt)
    }

    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        theme.ambient.intensity * (0.12 + solarPosition.daylight * 0.88),
        dt,
      )
      targets.ambColor.set(theme.ambient.color)
      targets.ambColor.lerp(NIGHT_AMBIENT_COLOR, 1 - solarPosition.daylight)
      ambientRef.current.color.lerp(targets.ambColor, dt)
    }
  })

  return (
    <>
      {theme.lights.map((light, index) => (
        <directionalLight
          castShadow={Boolean(light.castShadow) && !SHADOWS_DISABLED && shadows}
          // Remount on quality changes so three allocates a shadow target at
          // the new map size instead of retaining the existing GPU texture.
          key={`${shading}-${index}-${light.position.join(',')}`}
          position={light.position}
          ref={(ref) => {
            lightRefs.current[index] = ref
          }}
          shadow-bias={-0.002}
          shadow-mapSize={shading === 'hyper' ? [2048, 2048] : [1024, 1024]}
          shadow-normalBias={0.3}
          shadow-radius={1.5}
        >
          {light.castShadow && !SHADOWS_DISABLED && shadows ? (
            <orthographicCamera
              attach="shadow-camera"
              bottom={-shadowCameraSize}
              far={400}
              left={-shadowCameraSize}
              near={1}
              ref={shadowCamera}
              right={shadowCameraSize}
              top={shadowCameraSize}
            />
          ) : null}
        </directionalLight>
      ))}

      {theme.hemi ? <hemisphereLight ref={hemiRef} /> : null}

      <ambientLight ref={ambientRef} />
    </>
  )
}
