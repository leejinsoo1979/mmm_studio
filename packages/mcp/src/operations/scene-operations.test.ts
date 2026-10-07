import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { SqliteSceneStore } from '../storage/sqlite-scene-store'
import { createSceneOperations } from './scene-operations'

const graph = { nodes: {}, rootNodeIds: [] } as unknown as SceneGraph

describe('scene events through the operations facade', () => {
  let rootDir: string
  let store: SqliteSceneStore

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-operations-test-'))
    store = new SqliteSceneStore({ databasePath: path.join(rootDir, 'pascal.db') })
  })

  afterEach(async () => {
    store.close()
    await fs.rm(rootDir, { recursive: true, force: true })
  })

  // The store's methods use `this`: the facade must call them on the store.
  test('appends and lists events on a store whose methods use `this`', async () => {
    const operations = createSceneOperations({ store })
    const meta = await operations.saveScene({ id: 'live', name: 'Live', graph })

    const appended = await operations.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind: 'save_scene',
      graph,
    })

    expect(appended?.sceneId).toBe('live')
    const events = await operations.listSceneEvents('live')
    expect(events.map((event) => event.eventId)).toEqual([appended!.eventId])
    expect(await operations.listSceneEvents('live', { afterEventId: appended!.eventId })).toEqual(
      [],
    )
  })
})
