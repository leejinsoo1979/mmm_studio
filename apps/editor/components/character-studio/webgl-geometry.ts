import {
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
  IntType,
  type Mesh,
  type Object3D,
} from 'three'

/**
 * The studio draws with WebGL what the game draws with WebGPU: a body's
 * clone shares its geometry with every other body drawn from drei's copy
 * of the file (see avatar-rig.ts). The WebGPU renderer, as it first uploads
 * a non-normalized 8- or 16-bit integer attribute (the skin's bone slots),
 * widens the attribute's own array to 32 bits in place
 * (WebGPUAttributeUtils.createAttribute). WebGL binds a 32-bit integer
 * array as integers (vertexAttribIPointer), against three's shaders'
 * `in vec4 skinIndex`, and every draw of such a body fails
 * (GL_INVALID_OPERATION): opened during a game, the studio showed only
 * what the look had built anew (the wig, the scalp, bare feet). So each
 * render of the stage draws such a geometry from a twin whose attributes
 * WebGL reads as floats, sharing all else with it.
 */

type Attribute = BufferAttribute | InterleavedBufferAttribute

const isInterleaved = (attribute: Attribute): attribute is InterleavedBufferAttribute =>
  (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute === true

const versionOf = (attribute: Attribute) =>
  isInterleaved(attribute) ? attribute.data.version : attribute.version

/** Whether WebGL would read an attribute as integers where three's shaders read floats. */
function readAsIntegers(attribute: Attribute): boolean {
  if (attribute.normalized) return false
  if (!isInterleaved(attribute) && attribute.gpuType === IntType) return false
  const array = isInterleaved(attribute) ? attribute.data.array : attribute.array
  return array instanceof Uint32Array || array instanceof Int32Array
}

const floats = new WeakMap<Attribute, { copy: BufferAttribute; version: number }>()

/** An attribute's values as floats, filled again when it changes. */
function floatCopy(attribute: Attribute): BufferAttribute {
  const { count, itemSize } = attribute
  let known = floats.get(attribute)
  if (!known) {
    known = { copy: new BufferAttribute(new Float32Array(count * itemSize), itemSize), version: -1 }
    floats.set(attribute, known)
  }
  const version = versionOf(attribute)
  if (known.version !== version) {
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < itemSize; c++) known.copy.setComponent(i, c, attribute.getComponent(i, c))
    }
    known.copy.needsUpdate = true
    known.version = version
  }
  return known.copy
}

const twins = new WeakMap<BufferGeometry, BufferGeometry>()

/**
 * A geometry as the studio's WebGL renderer draws it: itself, or — where
 * WebGL would read an attribute as integers — its twin, that attribute in
 * floats in its place and all else (its points, its index) the geometry's
 * own. The twin follows the geometry's attributes as they change, and is
 * disposed with it.
 */
export function webglGeometry(geometry: BufferGeometry): BufferGeometry {
  const attributes = Object.entries(geometry.attributes)
  if (!attributes.some(([, attribute]) => readAsIntegers(attribute))) return geometry
  let twin = twins.get(geometry)
  if (!twin) {
    const made = new BufferGeometry()
    made.name = geometry.name
    twins.set(geometry, made)
    geometry.addEventListener('dispose', function gone() {
      geometry.removeEventListener('dispose', gone)
      twins.delete(geometry)
      made.dispose()
    })
    twin = made
  }
  for (const name of Object.keys(twin.attributes)) {
    if (!geometry.hasAttribute(name)) twin.deleteAttribute(name)
  }
  for (const [name, attribute] of attributes) {
    const drawn = readAsIntegers(attribute) ? floatCopy(attribute) : attribute
    if (twin.getAttribute(name) !== drawn) twin.setAttribute(name, drawn)
  }
  twin.index = geometry.index
  twin.morphAttributes = geometry.morphAttributes
  twin.morphTargetsRelative = geometry.morphTargetsRelative
  twin.groups = geometry.groups
  twin.drawRange = geometry.drawRange
  twin.boundingBox = geometry.boundingBox
  twin.boundingSphere = geometry.boundingSphere
  return twin
}

/**
 * Has every render of `scene` — the frame's, the contact shadow's, a
 * capture's — draw each geometry as webglGeometry gives it, and puts the
 * meshes' own back once it's drawn: outside a render a mesh holds its own,
 * which the look reshapes, keeps and compares by. Returns what stops it.
 */
export function drawWebglGeometries(scene: Object3D): () => void {
  const swapped: [Mesh, BufferGeometry][] = []
  const putBack = () => {
    for (const [mesh, geometry] of swapped) mesh.geometry = geometry
    swapped.length = 0
  }
  const { onBeforeRender, onAfterRender } = scene
  scene.onBeforeRender = (...args) => {
    onBeforeRender.apply(scene, args)
    // A render that threw never put its twins back.
    putBack()
    scene.traverseVisible((object) => {
      const mesh = object as Mesh
      if (!mesh.geometry?.isBufferGeometry) return
      const drawn = webglGeometry(mesh.geometry)
      if (drawn === mesh.geometry) return
      swapped.push([mesh, mesh.geometry])
      mesh.geometry = drawn
    })
  }
  scene.onAfterRender = (...args) => {
    putBack()
    onAfterRender.apply(scene, args)
  }
  return () => {
    putBack()
    scene.onBeforeRender = onBeforeRender
    scene.onAfterRender = onAfterRender
  }
}
