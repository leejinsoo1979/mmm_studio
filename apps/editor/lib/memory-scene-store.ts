import { createHash } from 'node:crypto'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import type {
  ProjectCreateOptions,
  ProjectStatus,
  SceneEvent,
  SceneEventAppendOptions,
  SceneEventListOptions,
  SceneListOptions,
  SceneMeta,
  SceneMutateOptions,
  SceneSaveOptions,
  SceneStore,
  SceneWithGraph,
} from '@pascal-app/mcp/storage'
import { SceneNotFoundError, SceneVersionConflictError } from '@pascal-app/mcp/storage'

type ProjectRecord = {
  id: string
  name: string
  ownerId: string | null
  thumbnailUrl: string | null
  createdAt: string
  updatedAt: string
}

export class MemorySceneStore implements SceneStore {
  readonly backend = 'sqlite' as const

  private readonly scenes = new Map<string, SceneWithGraph>()
  private readonly projects = new Map<string, ProjectRecord>()
  private readonly events = new Map<string, SceneEvent[]>()
  private sceneCounter = 0
  private eventCounter = 0

  async createProject(opts: ProjectCreateOptions): Promise<ProjectStatus> {
    const id = normalizeId(opts.id ?? `project-${++this.sceneCounter}`)
    const now = new Date().toISOString()
    this.projects.set(id, {
      id,
      name: opts.name,
      ownerId: opts.ownerId ?? null,
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    return this.toProjectStatus(id)
  }

  async getProjectStatus(id: string): Promise<ProjectStatus | null> {
    const safeId = normalizeId(id)
    if (!this.projects.has(safeId) && !this.scenes.has(safeId)) return null
    return this.toProjectStatus(safeId)
  }

  async save(opts: SceneSaveOptions): Promise<SceneMeta> {
    const id = normalizeId(opts.id ?? `scene-${++this.sceneCounter}`)
    const existing = this.scenes.get(id)
    if (opts.expectedVersion !== undefined && (existing?.version ?? 0) !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${id}" version mismatch: expected ${opts.expectedVersion}, got ${existing?.version ?? 0}`,
      )
    }

    const now = new Date().toISOString()
    const graph = cloneGraph(opts.graph)
    const graphJson = JSON.stringify(graph)
    const project = this.projects.get(id)
    const scene: SceneWithGraph = {
      id,
      name: opts.name,
      projectId: opts.projectId ?? existing?.projectId ?? project?.id ?? null,
      thumbnailUrl: opts.thumbnailUrl ?? existing?.thumbnailUrl ?? project?.thumbnailUrl ?? null,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? project?.createdAt ?? now,
      updatedAt: now,
      ownerId: opts.ownerId ?? existing?.ownerId ?? project?.ownerId ?? null,
      sizeBytes: Buffer.byteLength(graphJson, 'utf8'),
      nodeCount: Object.keys(graph.nodes ?? {}).length,
      editorUrl: `/editor/${id}`,
      url: `/editor/${id}`,
      published: true,
      graphHash: hashGraph(graphJson),
      graph,
    }

    this.scenes.set(id, scene)
    this.projects.set(id, {
      id,
      name: opts.name,
      ownerId: scene.ownerId,
      thumbnailUrl: scene.thumbnailUrl,
      createdAt: scene.createdAt,
      updatedAt: now,
    })
    return this.toMeta(scene)
  }

  async load(id: string): Promise<SceneWithGraph | null> {
    const scene = this.scenes.get(normalizeId(id))
    return scene ? { ...scene, graph: cloneGraph(scene.graph) } : null
  }

  async list(opts: SceneListOptions = {}): Promise<SceneMeta[]> {
    let scenes = Array.from(this.scenes.values()).map((scene) => this.toMeta(scene))
    if (opts.projectId !== undefined) scenes = scenes.filter((scene) => scene.projectId === opts.projectId)
    if (opts.ownerId !== undefined) scenes = scenes.filter((scene) => scene.ownerId === opts.ownerId)
    scenes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    if (opts.limit !== undefined) scenes = scenes.slice(0, opts.limit)
    return scenes
  }

  async delete(id: string, opts: SceneMutateOptions = {}): Promise<boolean> {
    const safeId = normalizeId(id)
    const existing = this.scenes.get(safeId)
    if (!existing) return false
    if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
      )
    }
    return this.scenes.delete(safeId)
  }

  async rename(id: string, newName: string, opts: SceneMutateOptions = {}): Promise<SceneMeta> {
    const safeId = normalizeId(id)
    const existing = this.scenes.get(safeId)
    if (!existing) throw new SceneNotFoundError(`Scene "${safeId}" not found`)
    if (opts.expectedVersion !== undefined && existing.version !== opts.expectedVersion) {
      throw new SceneVersionConflictError(
        `Scene "${safeId}" version mismatch: expected ${opts.expectedVersion}, got ${existing.version}`,
      )
    }
    const updated = {
      ...existing,
      name: newName,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    }
    this.scenes.set(safeId, updated)
    return this.toMeta(updated)
  }

  async appendSceneEvent(opts: SceneEventAppendOptions): Promise<SceneEvent> {
    const event: SceneEvent = {
      eventId: ++this.eventCounter,
      sceneId: normalizeId(opts.sceneId),
      version: opts.version,
      kind: opts.kind,
      createdAt: new Date().toISOString(),
      graph: cloneGraph(opts.graph),
    }
    const events = this.events.get(event.sceneId) ?? []
    events.push(event)
    this.events.set(event.sceneId, events)
    return event
  }

  async listSceneEvents(sceneId: string, opts: SceneEventListOptions = {}): Promise<SceneEvent[]> {
    const afterEventId = opts.afterEventId ?? 0
    const limit = opts.limit ?? 100
    return (this.events.get(normalizeId(sceneId)) ?? [])
      .filter((event) => event.eventId > afterEventId)
      .slice(0, limit)
      .map((event) => ({ ...event, graph: cloneGraph(event.graph) }))
  }

  private toMeta(scene: SceneWithGraph): SceneMeta {
    return {
      id: scene.id,
      name: scene.name,
      projectId: scene.projectId,
      thumbnailUrl: scene.thumbnailUrl,
      version: scene.version,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
      ownerId: scene.ownerId,
      sizeBytes: scene.sizeBytes,
      nodeCount: scene.nodeCount,
      editorUrl: scene.editorUrl,
      url: scene.url,
      published: scene.published,
      graphHash: scene.graphHash,
    }
  }

  private toProjectStatus(id: string): ProjectStatus {
    const scene = this.scenes.get(id)
    const project = this.projects.get(id)
    const now = new Date().toISOString()
    const editorUrl = `/editor/${id}`
    return {
      id,
      projectId: scene?.projectId ?? project?.id ?? id,
      name: scene?.name ?? project?.name ?? id,
      editorUrl,
      url: editorUrl,
      ownerId: scene?.ownerId ?? project?.ownerId ?? null,
      thumbnailUrl: scene?.thumbnailUrl ?? project?.thumbnailUrl ?? null,
      publishedVersion: scene?.version ?? null,
      latestVersion: scene?.version ?? null,
      draftVersion: null,
      browserVisibleVersion: scene?.version ?? null,
      version: scene?.version ?? 0,
      isEmpty: !scene || scene.nodeCount === 0,
      sizeBytes: scene?.sizeBytes ?? 0,
      nodeCount: scene?.nodeCount ?? 0,
      graphHash: scene?.graphHash ?? null,
      createdAt: scene?.createdAt ?? project?.createdAt ?? now,
      updatedAt: scene?.updatedAt ?? project?.updatedAt ?? now,
    }
  }
}

function cloneGraph(graph: SceneGraph): SceneGraph {
  return JSON.parse(JSON.stringify(graph)) as SceneGraph
}

function hashGraph(graphJson: string): string {
  return createHash('sha256').update(graphJson).digest('hex')
}

function normalizeId(id: string): string {
  return (
    id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `scene-${Date.now().toString(36)}`
  )
}
