'use client'

import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  registerWalkthroughInteraction,
  useWalkthroughView,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  type Intersection,
  Line,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { PROJECTOR_ID, type ScreenProjection, useItemScreens } from './screen'
import { projectionPicture, SCREEN_GAIN } from './screen-textures'

/**
 * What the aim can land on: the building's surfaces, and what stands in front
 * of them (furniture, stairs, trees) so a picture never lands behind them.
 * The site is left out here: it holds every building, so only its own ground
 * mesh is tested.
 */
const SURFACE_TYPES = [
  'wall',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'column',
  'fence',
  'stair',
  'item',
  'cabinet',
  'countertop',
  'shelf',
  'skylight',
  'chimney',
  'dormer',
  'trees:tree',
  'trees:flower',
  'trees:grass',
] as const
/** Helper meshes a registered part carries that nobody sees. */
const HIDDEN_PARTS = new Set(['cutout', 'collision-mesh', 'ceiling-grid', 'cutaway-outline-proxy'])
/** How far a projector throws. */
const THROW_DISTANCE = 40
/** Off the surface, so the picture doesn't flicker into it. */
const SURFACE_GAP = 0.006
/** A press that moves less than this (px) is a click, not a camera drag. */
const CLICK_SLOP = 6
/** One [ ] press scales the picture by this; the wheel scales with how far it turns. */
const RESIZE_STEP = 1.1
const WHEEL_RESIZE_PER_PIXEL = 0.001

/** A 1×1 picture plane whose UVs read unflipped (glTF-style) textures the right way up. */
function pictureGeometry() {
  const geometry = new PlaneGeometry(1, 1)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  return geometry
}

function outlineGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0],
      3,
    ),
  )
  return geometry
}

const titleFor = (id: string) => (id === PROJECTOR_ID ? '빔 프로젝터' : 'TV')

/**
 * Whether a hit landed on something people see: raycasts ignore visibility,
 * and doors, windows and walls carry invisible hit boxes and colliders.
 */
function seen(hit: Intersection) {
  const mesh = hit.object as Mesh
  if (!mesh.isMesh || HIDDEN_PARTS.has(mesh.name)) return false
  for (let o: Object3D | null = mesh; o; o = o.parent) if (!o.visible) return false
  const material = (
    Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material
  ) as Material | undefined
  return Boolean(material && material.visible !== false && material.colorWrite !== false)
}

/** The surfaces' roots to aim at: registered parts, and the site's own ground meshes. */
function aimTargets(): Object3D[] {
  const targets: Object3D[] = []
  for (const type of SURFACE_TYPES) {
    for (const id of sceneRegistry.byType[type] ?? []) {
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (object) targets.push(object)
    }
  }
  for (const id of sceneRegistry.byType.site ?? []) {
    for (const child of sceneRegistry.nodes.get(id as AnyNodeId)?.children ?? []) {
      if ((child as Mesh).isMesh) targets.push(child)
    }
  }
  return targets
}

const normalMatrix = new Matrix3()
const worldNormal = new Vector3()
const up = new Vector3()
const side = new Vector3()
const basis = new Matrix4()
const turn = new Quaternion()
const hits: Intersection[] = []

const corner = new Vector3()

/** How far to slide a picture along one axis so it stays within [low, high] where it fits. */
function slideWithin(low: number, high: number, half: number) {
  if (high - low <= 2 * half) return (low + high) / 2
  return Math.min(Math.max(0, low + half), high - half)
}

/**
 * Slides a picture centred at `centre` (facing along side × up) so it doesn't
 * hang past the edges of the part it lands on — a wall's end, a floor's edge;
 * a picture larger than the part is centred on it.
 */
function slideOntoPart(mesh: Mesh, centre: Vector3, halfWidth: number, halfHeight: number) {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return
  let minSide = Number.POSITIVE_INFINITY
  let maxSide = Number.NEGATIVE_INFINITY
  let minUp = Number.POSITIVE_INFINITY
  let maxUp = Number.NEGATIVE_INFINITY
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      )
      .applyMatrix4(mesh.matrixWorld)
      .sub(centre)
    const alongSide = corner.dot(side)
    const alongUp = corner.dot(up)
    minSide = Math.min(minSide, alongSide)
    maxSide = Math.max(maxSide, alongSide)
    minUp = Math.min(minUp, alongUp)
    maxUp = Math.max(maxUp, alongUp)
  }
  centre
    .addScaledVector(side, slideWithin(minSide, maxSide, halfWidth))
    .addScaledVector(up, slideWithin(minUp, maxUp, halfHeight))
}

/**
 * Where a picture (`width` across, `aspect` wide per high) lands for an aim
 * ray: the nearest seen surface it meets, faced out towards the thrower, and
 * slid in from the part's edges where it fits. On a wall the picture stands
 * upright; on a floor or ceiling its top points up the thrower's screen.
 */
export function aimProjection(
  raycaster: Raycaster,
  width: number,
  aspect: number,
  screenUp: Vector3,
): ScreenProjection | null {
  let nearest: Intersection | null = null
  for (const target of aimTargets()) {
    hits.length = 0
    raycaster.intersectObject(target, true, hits)
    for (const hit of hits) {
      if (nearest && hit.distance >= nearest.distance) break
      if (hit.face && seen(hit)) {
        nearest = hit
        break
      }
    }
  }
  if (!nearest?.face) return null
  normalMatrix.getNormalMatrix(nearest.object.matrixWorld)
  worldNormal.copy(nearest.face.normal).applyNormalMatrix(normalMatrix).normalize()
  if (worldNormal.dot(raycaster.ray.direction) > 0) worldNormal.negate()
  if (Math.abs(worldNormal.y) < 0.9) up.set(0, 1, 0)
  else up.copy(screenUp)
  up.projectOnPlane(worldNormal)
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1).projectOnPlane(worldNormal)
  up.normalize()
  side.crossVectors(up, worldNormal).normalize()
  basis.makeBasis(side, up, worldNormal)
  turn.setFromRotationMatrix(basis)
  const position = nearest.point.clone()
  slideOntoPart(nearest.object as Mesh, position, width / 2, width / aspect / 2)
  position.addScaledVector(worldNormal, SURFACE_GAP)
  return {
    position: [position.x, position.y, position.z],
    quaternion: [turn.x, turn.y, turn.z, turn.w],
    width,
  }
}

/** A picture material: unlit, and lifted to make up for the display's tone mapping. */
function pictureMaterial(extra: ConstructorParameters<typeof MeshBasicNodeMaterial>[0] = {}) {
  const material = new MeshBasicNodeMaterial({ fog: false, ...extra })
  material.color.setScalar(SCREEN_GAIN)
  return material
}

/** A screen's picture thrown onto a surface, at its own proportions. */
function Projection({ id, projection }: { id: string; projection: ScreenProjection }) {
  const group = useRef<Group>(null)
  const geometry = useMemo(pictureGeometry, [])
  const material = useMemo(() => pictureMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  useFrame(() => {
    const target = group.current
    const screen = useItemScreens.getState().screens[id]
    if (!(target && screen)) return
    const picture = projectionPicture(screen.content, titleFor(id))
    target.visible = Boolean(picture)
    if (!picture) return
    if (material.map !== picture.texture) {
      material.map = picture.texture
      material.needsUpdate = true
    }
    target.scale.set(projection.width, projection.width / picture.aspect, 1)
  })
  return (
    <group
      position={projection.position}
      quaternion={projection.quaternion}
      ref={group}
      visible={false}
    >
      <mesh geometry={geometry} material={material} renderOrder={1} />
    </group>
  )
}

const centre = new Vector2(0, 0)
const aimTurn = new Quaternion()
const aimNormal = new Vector3()

/** Wheel travel in pixels, whatever unit the device reports it in. */
function wheelPixels(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * 400
  return event.deltaY
}

/**
 * Aiming a projection: the picture, see-through and outlined, lands where the
 * view's centre meets a wall, floor or ceiling. The wheel or [ ] resizes it
 * (its proportions stay the picture's own); a click or E throws it there, Esc
 * gives up.
 */
function ProjectionAim({ id }: { id: string }) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const group = useRef<Group>(null)
  const aim = useRef<ScreenProjection | null>(null)
  const raycaster = useMemo(() => new Raycaster(), [])
  const screenUp = useMemo(() => new Vector3(), [])
  const geometry = useMemo(pictureGeometry, [])
  const material = useMemo(
    () => pictureMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    [],
  )
  // The outline goes on the editor's overlay layer, drawn over the scene, so
  // it stays crisp over the see-through picture.
  const outline = useMemo(() => {
    const line = new Line(
      outlineGeometry(),
      new LineBasicNodeMaterial({ color: '#7dd3fc', depthTest: false, depthWrite: false }),
    )
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 3
    return line
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      outline.geometry.dispose()
      ;(outline.material as LineBasicNodeMaterial).dispose()
    },
    [geometry, material, outline],
  )

  useEffect(() => {
    const place = () => {
      const target = aim.current
      if (!target) return
      const screens = useItemScreens.getState()
      screens.setProjection(id, target)
      screens.cancelPlacing()
    }
    // A made-up target id: the walkthrough outlines whatever its target is.
    const unregister = registerWalkthroughInteraction('screen-projection', {
      resolve: () =>
        aim.current ? { id: 'projection-aim', distance: 0, label: '여기에 투영' } : null,
      activate: place,
    })
    const onWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Node && canvas.contains(event.target))) return
      // Before the walkthrough's own wheel, which zooms or switches the view.
      event.preventDefault()
      event.stopImmediatePropagation()
      useItemScreens
        .getState()
        .resizePlacing(Math.exp(-wheelPixels(event) * WHEEL_RESIZE_PER_PIXEL))
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      const grow =
        event.code === 'BracketRight' ||
        event.code === 'Equal' ||
        event.code === 'NumpadAdd' ||
        event.key === ']' ||
        event.key === '+'
      const shrink =
        event.code === 'BracketLeft' ||
        event.code === 'Minus' ||
        event.code === 'NumpadSubtract' ||
        event.key === '['
      if (grow || shrink) {
        event.preventDefault()
        event.stopImmediatePropagation()
        useItemScreens.getState().resizePlacing(grow ? RESIZE_STEP : 1 / RESIZE_STEP)
      } else if (event.key === 'Escape') {
        // Before the walkthrough's own Esc, which would leave the game.
        event.preventDefault()
        event.stopImmediatePropagation()
        useItemScreens.getState().cancelPlacing()
      }
    }
    // With the pointer locked (first person) the browser keeps Esc to itself
    // and only lets go of the pointer: letting go gives up the aim.
    const onPointerLockChange = () => {
      if (!document.pointerLockElement && useWalkthroughView.getState().view === 'first') {
        useItemScreens.getState().cancelPlacing()
      }
    }
    // In third person, looking around drags the view: a still press places.
    // In first person the locked pointer's click takes E's path, and an
    // unlocked click only takes the pointer back.
    let pressed: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const onPointerUp = (event: PointerEvent) => {
      const start = pressed
      pressed = null
      if (!start || event.button !== 0) return
      if (useWalkthroughView.getState().view !== 'third') return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_SLOP) place()
    }
    // Clicks while aiming aren't selections.
    const wasDragging = useViewer.getState().inputDragging
    useViewer.getState().setInputDragging(true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      unregister()
      useViewer.getState().setInputDragging(wasDragging)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [canvas, id])

  useFrame(() => {
    const target = group.current
    const { placing, screens } = useItemScreens.getState()
    const screen = screens[id]
    if (!(target && placing && screen)) return
    raycaster.setFromCamera(centre, camera)
    raycaster.far = THROW_DISTANCE
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const picture = projectionPicture(screen.content, titleFor(id))
    const aspect = picture?.aspect ?? 16 / 9
    const found = aimProjection(raycaster, placing.width, aspect, screenUp)
    aim.current = found
    target.visible = Boolean(found)
    if (!found) return
    if (picture && material.map !== picture.texture) {
      material.map = picture.texture
      material.needsUpdate = true
    }
    aimTurn.fromArray(found.quaternion)
    // A second gap over the one the picture keeps: re-aiming a placed
    // projection shows the aim in front of it, not flickering into it.
    target.position
      .fromArray(found.position)
      .addScaledVector(aimNormal.set(0, 0, 1).applyQuaternion(aimTurn), SURFACE_GAP)
    target.quaternion.copy(aimTurn)
    target.scale.set(found.width, found.width / aspect, 1)
  })

  return (
    <group ref={group} visible={false}>
      <mesh geometry={geometry} material={material} renderOrder={2} />
      <primitive object={outline} />
    </group>
  )
}

/**
 * The walkthrough's projections: every switched-on screen's thrown picture,
 * and the aim of the one being placed.
 */
export function ScreenProjections() {
  const screens = useItemScreens((state) => state.screens)
  const placingId = useItemScreens((state) => state.placing?.id ?? null)
  return (
    <>
      {Object.entries(screens).map(
        ([id, screen]) =>
          screen.projection && <Projection id={id} key={id} projection={screen.projection} />,
      )}
      {placingId && <ProjectionAim id={placingId} key={placingId} />}
    </>
  )
}
