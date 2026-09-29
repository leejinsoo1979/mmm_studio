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
  type InstancedMesh,
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
 * of them (furniture, stairs, elevators) so a picture never lands behind them.
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
  'elevator',
  'item',
  'cabinet',
  'countertop',
  'shelf',
  'skylight',
  'chimney',
  'dormer',
] as const
/** Helper meshes a registered part carries that nobody sees. */
const HIDDEN_PARTS = new Set(['cutout', 'collision-mesh', 'ceiling-grid', 'cutaway-outline-proxy'])
/** How far a projector throws. */
const THROW_DISTANCE = 40
/** Off the surface, so the picture doesn't flicker into it. */
const SURFACE_GAP = 0.006
/** A picture further than this off every corner of its plane is on a curved part. */
const FLAT_TOLERANCE = 0.002
/** Grid a picture is bent over to follow a curved part: finer once placed. */
const PLACED_SEGMENTS = 16
const AIM_SEGMENTS = 8
/** A press that moves less than this (px) is a click, not a camera drag. */
const CLICK_SLOP = 6
/** One [ ] press scales the picture by this; the wheel scales with how far it turns. */
const RESIZE_STEP = 1.1
const WHEEL_RESIZE_PER_PIXEL = 0.001

/**
 * A 1×1 picture plane (`segments` across and down, to bend over curved
 * parts) whose UVs read unflipped (glTF-style) textures the right way up.
 */
export function pictureGeometry(segments = 1) {
  const geometry = new PlaneGeometry(1, 1, segments, segments)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  return geometry
}

/** A closed line round the edge of a `pictureGeometry(segments)`, one point per edge vertex. */
function outlineGeometry(segments: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array((4 * segments + 1) * 3), 3),
  )
  return geometry
}

/** Lays an outline along the edge of a (bent) picture plane of `segments` per side. */
function traceOutline(outline: BufferGeometry, picture: BufferGeometry, segments: number) {
  const from = picture.getAttribute('position')
  const to = outline.getAttribute('position')
  const row = segments + 1
  // The plane's vertices run row by row from the top left: walk its rim clockwise.
  const rim: number[] = []
  for (let x = 0; x < segments; x++) rim.push(x)
  for (let y = 0; y < segments; y++) rim.push(y * row + segments)
  for (let x = segments; x > 0; x--) rim.push(segments * row + x)
  for (let y = segments; y > 0; y--) rim.push(y * row)
  rim.push(0)
  rim.forEach((vertex, i) => {
    to.setXYZ(i, from.getX(vertex), from.getY(vertex), from.getZ(vertex))
  })
  to.needsUpdate = true
  outline.computeBoundingSphere()
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

const hits: Intersection[] = []

/** The nearest seen surface a ray meets. */
function nearestSeenHit(raycaster: Raycaster): Intersection | null {
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
  return nearest
}

const partMatrixWorld = new Matrix4()
const instanceMatrix = new Matrix4()
/** Where a part's geometry sits in the world (an elevator's instance included). */
function partMatrix(mesh: Mesh, instanceId: number | undefined) {
  const instanced = mesh as InstancedMesh
  if (!(instanced.isInstancedMesh && instanceId !== undefined)) return mesh.matrixWorld
  instanced.getMatrixAt(instanceId, instanceMatrix)
  return partMatrixWorld.multiplyMatrices(mesh.matrixWorld, instanceMatrix)
}

const frameSide = new Vector3()
const frameUp = new Vector3()
const frameNormal = new Vector3()
/** A picture's own axes (right, up, out of the surface) for its turn. */
function frameAxes(turn: Quaternion) {
  frameSide.set(1, 0, 0).applyQuaternion(turn)
  frameUp.set(0, 1, 0).applyQuaternion(turn)
  frameNormal.set(0, 0, 1).applyQuaternion(turn)
}

const corner = new Vector3()

/** How far to slide a picture along one axis so it stays within [low, high] where it fits. */
function slideWithin(low: number, high: number, half: number) {
  if (high - low <= 2 * half) return (low + high) / 2
  return Math.min(Math.max(0, low + half), high - half)
}

/**
 * Slides a picture centred at `centre` (facing along the frame's axes) so it
 * doesn't hang past the edges of the part it lands on — a wall's end, a
 * floor's edge. A flat picture can't wrap round a corner or be cut at an
 * edge, so one larger than the part is shrunk (its proportions kept) to fill
 * it: returns that scale, 1 when it fits.
 */
function slideOntoPart(
  mesh: Mesh,
  matrix: Matrix4,
  centre: Vector3,
  halfWidth: number,
  halfHeight: number,
): number {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return 1
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
      .applyMatrix4(matrix)
      .sub(centre)
    const alongSide = corner.dot(frameSide)
    const alongUp = corner.dot(frameUp)
    minSide = Math.min(minSide, alongSide)
    maxSide = Math.max(maxSide, alongSide)
    minUp = Math.min(minUp, alongUp)
    maxUp = Math.max(maxUp, alongUp)
  }
  const scale = Math.min(
    1,
    (maxSide - minSide) / (2 * halfWidth),
    (maxUp - minUp) / (2 * halfHeight),
  )
  centre
    .addScaledVector(frameSide, slideWithin(minSide, maxSide, halfWidth * scale))
    .addScaledVector(frameUp, slideWithin(minUp, maxUp, halfHeight * scale))
  return scale
}

const conformRay = new Raycaster()
const rayOrigin = new Vector3()
const rayBack = new Vector3()

/**
 * Bends a picture's plane onto the part it sits on: the inside of a round
 * wall would otherwise hide most of a flat picture, and one on the outside
 * would stand off it. `centre` (`gap` off the surface), `turn`, `width` and
 * `height` are the picture's frame; points past the part's edge stay on the
 * plane. A flat part (most are) is told apart by the picture's corners.
 */
export function conformToPart(
  geometry: BufferGeometry,
  part: Mesh,
  centre: Vector3,
  turn: Quaternion,
  width: number,
  height: number,
  gap = SURFACE_GAP,
) {
  frameAxes(turn)
  const reach = Math.max(0.5, Math.max(width, height) / 2)
  rayBack.copy(frameNormal).negate()
  // How far the surface stands in front of the picture's plane at (x, y).
  const depthAt = (x: number, y: number) => {
    rayOrigin
      .copy(centre)
      .addScaledVector(frameSide, x * width)
      .addScaledVector(frameUp, y * height)
      .addScaledVector(frameNormal, reach)
    conformRay.set(rayOrigin, rayBack)
    conformRay.far = reach * 2
    hits.length = 0
    conformRay.intersectObject(part, false, hits)
    const hit = hits.find(seen)
    return hit ? hit.point.sub(centre).dot(frameNormal) + gap : 0
  }
  const flat = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].every(([x, y]) => Math.abs(depthAt(x!, y!)) < FLAT_TOLERANCE)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    positions.setZ(i, flat ? 0 : depthAt(positions.getX(i), positions.getY(i)))
  }
  positions.needsUpdate = true
  geometry.computeBoundingSphere()
}

const normalMatrix = new Matrix3()
const worldNormal = new Vector3()
const up = new Vector3()
const side = new Vector3()
const basis = new Matrix4()
const turn = new Quaternion()

/**
 * Where a picture (`width` across, `aspect` wide per high) lands for an aim
 * ray: the nearest seen surface it meets, faced out towards the thrower, and
 * slid in from the part's edges where it fits — with the part it lands on.
 * On a wall the picture stands upright; on a floor or ceiling its top points
 * up the thrower's screen.
 */
export function aimProjection(
  raycaster: Raycaster,
  width: number,
  aspect: number,
  screenUp: Vector3,
): { projection: ScreenProjection; part: Mesh } | null {
  const nearest = nearestSeenHit(raycaster)
  if (!nearest?.face) return null
  const part = nearest.object as Mesh
  const matrix = partMatrix(part, nearest.instanceId)
  normalMatrix.getNormalMatrix(matrix)
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
  frameAxes(turn)
  const position = nearest.point.clone()
  const scale = slideOntoPart(part, matrix, position, width / 2, width / aspect / 2)
  position.addScaledVector(worldNormal, SURFACE_GAP)
  return {
    projection: {
      position: [position.x, position.y, position.z],
      quaternion: [turn.x, turn.y, turn.z, turn.w],
      width: width * scale,
    },
    part,
  }
}

const fitRay = new Raycaster()

/**
 * Where a placed picture shows at its current `height`: slid back onto the
 * part it was thrown on (a new size or a page of other proportions can reach
 * past its edges), and shrunk by `scale` where it can't fit, with that part.
 * The placed spot and size themselves stay as set, so shrinking the picture
 * again brings it back there.
 */
export function fitPlacedProjection(
  projection: ScreenProjection,
  height: number,
): { centre: Vector3; turn: Quaternion; scale: number; part: Mesh | null } {
  const placedTurn = new Quaternion().fromArray(projection.quaternion)
  const centre = new Vector3().fromArray(projection.position)
  frameAxes(placedTurn)
  fitRay.set(
    rayOrigin.copy(centre).addScaledVector(frameNormal, 0.05),
    rayBack.copy(frameNormal).negate(),
  )
  fitRay.far = 0.1 + SURFACE_GAP
  const hit = nearestSeenHit(fitRay)
  const part = (hit?.object as Mesh | undefined) ?? null
  let scale = 1
  if (part) {
    frameAxes(placedTurn)
    scale = slideOntoPart(
      part,
      partMatrix(part, hit?.instanceId),
      centre,
      projection.width / 2,
      height / 2,
    )
  }
  return { centre, turn: placedTurn, scale, part }
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
  const fitted = useRef<{ projection: ScreenProjection; aspect: number } | null>(null)
  const geometry = useMemo(() => pictureGeometry(PLACED_SEGMENTS), [])
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
    const last = fitted.current
    if (last?.projection === projection && last.aspect === picture.aspect) return
    fitted.current = { projection, aspect: picture.aspect }
    const fit = fitPlacedProjection(projection, projection.width / picture.aspect)
    const width = projection.width * fit.scale
    const height = width / picture.aspect
    target.position.copy(fit.centre)
    target.quaternion.copy(fit.turn)
    target.scale.set(width, height, 1)
    if (fit.part) conformToPart(geometry, fit.part, fit.centre, fit.turn, width, height)
  })
  return (
    <group ref={group} visible={false}>
      <mesh geometry={geometry} material={material} renderOrder={1} />
    </group>
  )
}

const viewCentre = new Vector2(0, 0)
const aimTurn = new Quaternion()
const aimCentre = new Vector3()

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
  const geometry = useMemo(() => pictureGeometry(AIM_SEGMENTS), [])
  const material = useMemo(
    () => pictureMaterial({ transparent: true, opacity: 0.6, depthWrite: false }),
    [],
  )
  // The outline goes on the editor's overlay layer, drawn over the scene, so
  // it stays crisp over the see-through picture.
  const outline = useMemo(() => {
    const line = new Line(
      outlineGeometry(AIM_SEGMENTS),
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
    raycaster.setFromCamera(viewCentre, camera)
    raycaster.far = THROW_DISTANCE
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
    const picture = projectionPicture(screen.content, titleFor(id))
    const aspect = picture?.aspect ?? 16 / 9
    const found = aimProjection(raycaster, placing.width, aspect, screenUp)
    aim.current = found?.projection ?? null
    target.visible = Boolean(found)
    if (!found) return
    // Follows the picture even to none (a page loading), so a released
    // texture is never left on.
    const texture = picture?.texture ?? null
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    const height = found.projection.width / aspect
    aimTurn.fromArray(found.projection.quaternion)
    // A second gap over the one the picture keeps: re-aiming a placed
    // projection shows the aim in front of it, not flickering into it.
    frameAxes(aimTurn)
    aimCentre.fromArray(found.projection.position).addScaledVector(frameNormal, SURFACE_GAP)
    target.position.copy(aimCentre)
    target.quaternion.copy(aimTurn)
    target.scale.set(found.projection.width, height, 1)
    conformToPart(
      geometry,
      found.part,
      aimCentre,
      aimTurn,
      found.projection.width,
      height,
      2 * SURFACE_GAP,
    )
    traceOutline(outline.geometry, geometry, AIM_SEGMENTS)
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
