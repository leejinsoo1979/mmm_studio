import type { LightNode, ParametricDescriptor } from '@pascal-app/core'

export const lightParametrics: ParametricDescriptor<LightNode> = {
  groups: [],
  customPanel: () => import('./panel'),
}
