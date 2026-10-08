import { Fn, float, max, normalView, positionViewDirection, sheen, sheenRoughness } from 'three/tsl'
import { MeshPhysicalNodeMaterial, PhysicalLightingModel, type WebGPURenderer } from 'three/webgpu'

/**
 * three r184's WebGPU sheen (BRDF_Sheen.js) divides by `dotNL + dotNV −
 * dotNL·dotNV`, which is 0 where a surface faces away from both a light and
 * the eye — at the silhouette of any smooth mesh — and multiplies the
 * infinity by the light's 0 irradiance there. The NaN blacks the pixel out:
 * a sheened material (the Rocketbox heads' skin) is outlined by broken black
 * lines. WebGL's version saturates the term, which is what this does,
 * without the division by zero. The rest is three's, unchanged.
 */

// https://github.com/google/filament/blob/master/shaders/src/brdf.fs
const D_Charlie = Fn(([roughness, dotNH]: any[]) => {
  const invAlpha = float(1).div(roughness.pow2())
  const sin2h = dotNH.pow2().oneMinus().max(0.0078125)
  return float(2)
    .add(invAlpha)
    .mul(sin2h.pow(invAlpha.mul(0.5)))
    .div(2 * Math.PI)
})

/** Neubelt and Pettineo 2013, saturated as three's GLSL has it: min(1 / 4x, 1) = 1 / max(4x, 1). */
const V_Neubelt = Fn(([dotNV, dotNL]: any[]) =>
  float(1).div(max(float(4).mul(dotNL.add(dotNV).sub(dotNL.mul(dotNV))), 1)),
)

const BRDF_Sheen = Fn(([lightDirection]: any[]) => {
  const halfDir = lightDirection.add(positionViewDirection).normalize()
  const dotNL = normalView.dot(lightDirection).clamp()
  const dotNV = normalView.dot(positionViewDirection).clamp()
  const dotNH = normalView.dot(halfDir).clamp()
  return sheen.mul(D_Charlie(sheenRoughness, dotNH)).mul(V_Neubelt(dotNV, dotNL))
})

/** three's curve fit of the Charlie sheen's directional albedo (PhysicalLightingModel.js, unexported). */
const IBLSheenBRDF = Fn(([normal, viewDir, roughness]: any[]) => {
  const dotNV = normal.dot(viewDir).saturate()
  const r2 = roughness.mul(roughness)
  const rInv = roughness.add(0.1).reciprocal()
  const a = roughness.mul(1.0678).add(r2.mul(0.4573)).sub(rInv.mul(0.8469)).sub(1.9362)
  const b = roughness.mul(0.5538).sub(r2.mul(0.467)).sub(rInv.mul(0.1255)).sub(0.6014)
  return a.mul(dotNV).add(b).exp().saturate()
})

type DirectInput = Parameters<PhysicalLightingModel['direct']>[0]
type Builder = Parameters<PhysicalLightingModel['direct']>[1]

/**
 * The physical lighting model with the direct sheen term above. Its
 * energy compensation, which three applies to the light's irradiance, is
 * passed to the rest of `direct` in the light's colour, irradiance being
 * linear in it. With clearcoat, whose term reads the light's colour too,
 * three's own runs.
 */
class SheenSafeLightingModel extends PhysicalLightingModel {
  override direct(input: DirectInput, builder: Builder) {
    const model = this as unknown as {
      sheen: boolean
      clearcoat: boolean
      sheenSpecularDirect: any
    }
    if (!model.sheen || model.clearcoat) return super.direct(input, builder)
    const { lightDirection, lightColor } = input as unknown as {
      lightDirection: any
      lightColor: any
    }
    const irradiance = normalView.dot(lightDirection).clamp().mul(lightColor)
    model.sheenSpecularDirect.addAssign(irradiance.mul(BRDF_Sheen(lightDirection)))
    const albedoV = IBLSheenBRDF(normalView, positionViewDirection, sheenRoughness)
    const albedoL = IBLSheenBRDF(normalView, lightDirection, sheenRoughness)
    const energy = sheen.r.max(sheen.g).max(sheen.b).mul(albedoV.max(albedoL)).oneMinus()
    model.sheen = false
    try {
      super.direct({ ...input, lightColor: lightColor.mul(energy) } as DirectInput, builder)
    } finally {
      model.sheen = true
    }
  }
}

export class SheenSafePhysicalNodeMaterial extends MeshPhysicalNodeMaterial {
  override setupLightingModel() {
    const material = this as unknown as {
      useClearcoat: boolean
      useSheen: boolean
      useIridescence: boolean
      useAnisotropy: boolean
      useTransmission: boolean
      useDispersion: boolean
    }
    return new SheenSafeLightingModel(
      material.useClearcoat,
      material.useSheen,
      material.useIridescence,
      material.useAnisotropy,
      material.useTransmission,
      material.useDispersion,
    )
  }
}

/**
 * Has the renderer draw every MeshPhysicalMaterial (glTF's, with sheen) as
 * SheenSafePhysicalNodeMaterial. Node materials are drawn as they are.
 */
export function installSheenSafeMaterial(renderer: WebGPURenderer) {
  const library = (renderer as unknown as { library: { materialNodes: Map<string, unknown> } })
    .library
  library.materialNodes.set('MeshPhysicalMaterial', SheenSafePhysicalNodeMaterial)
}
