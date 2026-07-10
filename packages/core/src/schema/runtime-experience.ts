export type ConfiguratorTarget = {
  nodeId: string
  role: string
}

export type ConfiguratorOption = {
  id: string
  label: string
  materialRef?: string
  assetId?: string
  thumbnailUrl?: string
  priceDelta?: number
}

export type ConfiguratorGroup = {
  id: string
  label: string
  target: ConfiguratorTarget
  defaultOptionId: string
  options: ConfiguratorOption[]
}

export type RuntimeCameraPreset = {
  id: string
  label: string
  position: [number, number, number]
  target: [number, number, number]
  fov?: number
}

export type RuntimeExperience = {
  version: 1
  configurators: ConfiguratorGroup[]
  cameras: RuntimeCameraPreset[]
  multiplayer: {
    enabled: boolean
    chat: boolean
    maxParticipants: number
    visibility: 'public' | 'invite-only'
  }
}

export const DEFAULT_RUNTIME_EXPERIENCE: RuntimeExperience = {
  version: 1,
  configurators: [],
  cameras: [],
  multiplayer: {
    enabled: true,
    chat: true,
    maxParticipants: 16,
    visibility: 'public',
  },
}
