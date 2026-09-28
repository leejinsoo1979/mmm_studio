import { type AnyNodeId, emitter, sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Intersection, Material, Object3D } from 'three'
import { Matrix4, Mesh, MeshBasicNodeMaterial, Ray, Raycaster, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import {
  CUTAWAY_STUB_HEIGHT,
  getMaterialsForWall,
  getSelectionHighlightMaterials,
} from './wall-materials'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()

const CUTAWAY_KEY = 'cutaway'
const PROBE_LIFT = 100
const _hits: Intersection[] = []
const _inverse = new Matrix4()
const _localRay = new Ray()
const _probe = new Raycaster()
const _point = new Vector3()

/** True while the wall is drawn as its low cutaway stub. */
export function isWallCutaway(object: Object3D | null | undefined): boolean {
  return object?.userData[CUTAWAY_KEY] === true
}

/** Whether a vertical probe through local (x, z) meets the wall volume. */
function footprintContains(mesh: Mesh, x: number, z: number): boolean {
  for (const lift of [PROBE_LIFT, -PROBE_LIFT]) {
    _probe.ray.origin.set(x, CUTAWAY_STUB_HEIGHT + lift, z).applyMatrix4(mesh.matrixWorld)
    _probe.ray.direction.set(0, -Math.sign(lift), 0).transformDirection(mesh.matrixWorld)
    _hits.length = 0
    Mesh.prototype.raycast.call(mesh, _probe, _hits)
    if (_hits.length > 0) return true
  }
  return false
}

/**
 * The collision mesh keeps the wall's full volume, but a cut wall only shows
 * its stub: the pointer passes through the cut-away part to whatever is behind
 * it, and the stub's cut face still picks the wall.
 */
function stubOnlyRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
  if (!isWallCutaway(this.parent)) {
    Mesh.prototype.raycast.call(this, raycaster, intersects)
    return
  }
  const hits: Intersection[] = []
  Mesh.prototype.raycast.call(this, raycaster, hits)
  _inverse.copy(this.matrixWorld).invert()
  let kept = false
  for (const hit of hits) {
    _point.copy(hit.point).applyMatrix4(_inverse)
    if (_point.y <= CUTAWAY_STUB_HEIGHT + 1e-3) {
      intersects.push(hit)
      kept = true
    }
  }
  if (kept) return

  _localRay.copy(raycaster.ray).applyMatrix4(_inverse)
  const dy = _localRay.direction.y
  if (dy > -1e-6) return
  const t = (CUTAWAY_STUB_HEIGHT - _localRay.origin.y) / dy
  if (t <= 0) return
  _localRay.at(t, _point)
  if (!footprintContains(this, _point.x, _point.z)) return
  const point = _point.clone().applyMatrix4(this.matrixWorld)
  const distance = raycaster.ray.origin.distanceTo(point)
  if (distance < raycaster.near || distance > raycaster.far) return
  intersects.push({ distance, point, object: this, face: null })
}

function getWallHideState(
  wallNode: WallNode,
  wallMesh: Mesh,
  wallMode: string,
  cameraDir: Vector3,
): boolean {
  let hideWall = wallNode.frontSide === 'interior' && wallNode.backSide === 'interior'

  if (wallMode === 'up') {
    hideWall = false
  } else if (wallMode === 'down') {
    hideWall = true
  } else {
    wallMesh.getWorldDirection(v)
    if (v.dot(cameraDir) < 0) {
      if (wallNode.frontSide === 'exterior' && wallNode.backSide !== 'exterior') {
        hideWall = true
      }
    } else if (wallNode.backSide === 'exterior' && wallNode.frontSide !== 'exterior') {
      hideWall = true
    }
  }

  return hideWall
}

const OUTLINE_PROXY_NAME = 'cutaway-outline-proxy'
// Draws nothing itself: only the outline passes (which swap in their own
// materials) see it.
const outlineProxyMaterial = new MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false })

/**
 * The selection / hover outline of a cut wall traces its stub, not the full
 * wall the outline passes would otherwise draw (they ignore the cut). The
 * proxy is the wall's solid volume squashed to the stub height.
 */
function getCutawayOutlineProxy(wallMesh: Object3D): Mesh | null {
  const collision = wallMesh.getObjectByName('collision-mesh') as Mesh | undefined
  if (!collision) return null
  let proxy = wallMesh.getObjectByName(OUTLINE_PROXY_NAME) as Mesh | undefined
  if (!proxy) {
    proxy = new Mesh(collision.geometry, outlineProxyMaterial)
    proxy.name = OUTLINE_PROXY_NAME
    proxy.raycast = () => {}
    wallMesh.add(proxy)
  }
  if (proxy.geometry !== collision.geometry) proxy.geometry = collision.geometry
  const geometry = proxy.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const top = geometry.boundingBox?.max.y ?? 0
  proxy.scale.y = top > CUTAWAY_STUB_HEIGHT ? CUTAWAY_STUB_HEIGHT / top : 1
  return proxy
}

/** Swaps cut walls in an outline list for their stub proxies (and back). */
function syncOutlineTargets(objects: Object3D[], inUse: Set<Object3D>) {
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]!
    if (object.name === OUTLINE_PROXY_NAME) {
      if (object.parent && !isWallCutaway(object.parent)) objects[i] = object.parent
      else inUse.add(object)
    } else if (isWallCutaway(object)) {
      const proxy = getCutawayOutlineProxy(object)
      if (proxy) {
        objects[i] = proxy
        inUse.add(proxy)
      }
    }
  }
}

const liveProxies = new Set<Object3D>()

/** Keeps proxies only while an outline shows them (their geometry is borrowed). */
function syncOutlineProxies(selected: Object3D[], hovered: Object3D[]) {
  const inUse = new Set<Object3D>()
  syncOutlineTargets(selected, inUse)
  syncOutlineTargets(hovered, inUse)
  for (const proxy of liveProxies) {
    if (!inUse.has(proxy)) {
      proxy.removeFromParent()
      liveProxies.delete(proxy)
    }
  }
  for (const proxy of inUse) liveProxies.add(proxy)
}

function sameMaterialArray(a: Material | Material[], b: Material[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((material, i) => material === b[i])
}

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())
  const lastUpdateTime = useRef(0)
  const lastWallMode = useRef<string>(useViewer.getState().wallMode)
  const lastShading = useRef(useViewer.getState().shading)
  const lastNumberOfWalls = useRef(0)
  const lastHighlightKey = useRef('')
  const lastTextures = useRef(useViewer.getState().textures)
  const lastColorPreset = useRef(useViewer.getState().colorPreset)
  const lastSceneTheme = useRef(useViewer.getState().sceneTheme)

  useFrame(({ camera, clock }) => {
    const { outliner } = useViewer.getState()
    syncOutlineProxies(outliner.selectedObjects, outliner.hoveredObjects)
    const wallMode = useViewer.getState().wallMode
    const shading = useViewer.getState().shading
    const textures = useViewer.getState().textures
    const colorPreset = useViewer.getState().colorPreset
    const sceneTheme = useViewer.getState().sceneTheme
    const selectedIds = useViewer.getState().selection.selectedIds
    const previewSelectedIds = useViewer.getState().previewSelectedIds
    const hoveredId = useViewer.getState().hoveredId
    const hoverHighlightMode = useViewer.getState().hoverHighlightMode
    const wallSelectionTint = useViewer.getState().wallSelectionTint
    const currentTime = clock.elapsedTime
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)
    const highlightedWallIds = new Set(
      wallSelectionTint
        ? [...selectedIds, ...previewSelectedIds].filter(
            (id) => useScene.getState().nodes[id as AnyNodeId]?.type === 'wall',
          )
        : [],
    )
    const deleteHoveredWallId =
      hoverHighlightMode === 'delete' &&
      hoveredId &&
      useScene.getState().nodes[hoveredId as AnyNodeId]?.type === 'wall'
        ? hoveredId
        : null
    const highlightKey = `${Array.from(highlightedWallIds).sort().join('|')}::${deleteHoveredWallId ?? ''}`

    const distanceMoved = currentCameraPosition.distanceTo(lastCameraPosition.current)
    const directionChanged = tmpVec.distanceTo(lastCameraTarget.current)
    const timeSinceUpdate = currentTime - lastUpdateTime.current

    if (
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      lastShading.current !== shading ||
      lastTextures.current !== textures ||
      lastColorPreset.current !== colorPreset ||
      lastSceneTheme.current !== sceneTheme ||
      sceneRegistry.byType.wall!.size !== lastNumberOfWalls.current ||
      lastHighlightKey.current !== highlightKey
    ) {
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      const walls = sceneRegistry.byType.wall!
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (wallNode?.type !== 'wall') return

        const hideWall = getWallHideState(wallNode, wallMesh as Mesh, wallMode, u)
        wallMesh.userData[CUTAWAY_KEY] = hideWall && wallMode !== 'translucent'
        const collisionMesh = wallMesh.getObjectByName('collision-mesh')
        if (collisionMesh && collisionMesh.raycast !== stubOnlyRaycast) {
          collisionMesh.raycast = stubOnlyRaycast as Object3D['raycast']
        }
        const isDeleteHighlighted = deleteHoveredWallId === wallId
        const isSelectionHighlighted = !isDeleteHighlighted && highlightedWallIds.has(wallId)
        const materials = getMaterialsForWall(
          wallNode,
          shading,
          textures,
          colorPreset,
          sceneTheme,
          useScene.getState().materials,
        )

        if (wallMode === 'translucent') {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteTranslucent
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.translucent)
              : materials.translucent
        } else if (hideWall) {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteInvisible
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.invisible)
              : materials.invisible
        } else {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteVisible
            : isSelectionHighlighted
              ? getSelectionHighlightMaterials(materials.visible)
              : materials.visible
        }
      })
      lastWallMode.current = wallMode
      lastShading.current = shading
      lastTextures.current = textures
      lastColorPreset.current = colorPreset
      lastSceneTheme.current = sceneTheme
      lastNumberOfWalls.current = sceneRegistry.byType.wall!.size
      lastHighlightKey.current = highlightKey
    }
  })

  useEffect(() => {
    const snapshot = new Map<Mesh, Material | Material[]>()

    const restoreForCapture = () => {
      sceneRegistry.byType.wall!.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId) as Mesh | undefined
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as AnyNodeId] as WallNode | undefined
        if (wallNode?.type !== 'wall') return
        const mats = getMaterialsForWall(
          wallNode,
          useViewer.getState().shading,
          useViewer.getState().textures,
          useViewer.getState().colorPreset,
          useViewer.getState().sceneTheme,
          useScene.getState().materials,
        )
        const current = wallMesh.material as Material | Material[]
        snapshot.set(wallMesh, current)
        if (current === mats.deleteVisible) {
          wallMesh.material = mats.visible
        } else if (current === mats.deleteInvisible) {
          wallMesh.material = mats.invisible
        } else if (
          current === mats.deleteTranslucent ||
          sameMaterialArray(current, getSelectionHighlightMaterials(mats.translucent))
        ) {
          wallMesh.material = mats.translucent
        }
      })
    }

    const reapplyAfterCapture = () => {
      snapshot.forEach((mat, mesh) => {
        mesh.material = mat
      })
      snapshot.clear()
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [])

  return null
}
