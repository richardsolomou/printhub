import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { createAssetKey } from '../core/assetKeys'
import type { PrintRequest } from '../core/types'
import { ASSET_LAYOUT_SETTING, ASSET_LAYOUT_VERSION, migrateAssetLayout } from './assetLayoutMigration'

const requestId = '00000000-0000-4000-8000-000000000001'

describe('stable asset layout migration', () => {
  let root: string
  let assets: LocalAssetStore

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-asset-layout-'))
    assets = new LocalAssetStore(root)
    await assets.initialize()
  })

  afterEach(async () => fs.promises.rm(root, { recursive: true, force: true }))

  it('moves a legacy model and updates its stored path', async () => {
    const legacyPath = 'in-progress/legacy-model.stl'
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    const repository = migrationRepository(legacyPath)

    await migrateAssetLayout(repository, assets)

    const destination = createAssetKey(requestId, 'Original Model.stl')
    expect(await assets.exists(legacyPath)).toBe(false)
    expect(await assets.exists(destination)).toBe(true)
    expect(repository.getRequest(requestId)?.filePath).toBe(destination)
    expect(repository.getSetting(ASSET_LAYOUT_SETTING)).toBe(ASSET_LAYOUT_VERSION)
    await expect(fs.promises.stat(path.join(root, 'in-progress'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resumes after the model moved but before its database path changed', async () => {
    const legacyPath = 'todo/legacy-model.stl'
    const destination = createAssetKey(requestId, 'Original Model.stl')
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    await assets.ensureMoved(legacyPath, destination)
    const repository = migrationRepository(legacyPath)

    await migrateAssetLayout(repository, assets)

    expect(repository.getRequest(requestId)?.filePath).toBe(destination)
    expect(repository.getSetting(ASSET_LAYOUT_SETTING)).toBe(ASSET_LAYOUT_VERSION)
  })

  it('does not rerun a completed migration', async () => {
    const repository = migrationRepository('todo/missing.stl')
    repository.setSetting(ASSET_LAYOUT_SETTING, ASSET_LAYOUT_VERSION)

    await migrateAssetLayout(repository, assets)

    expect(repository.getRequest(requestId)?.filePath).toBe('todo/missing.stl')
  })

  it('stops without changing the database when the destination conflicts', async () => {
    const legacyPath = 'todo/legacy-model.stl'
    const destination = createAssetKey(requestId, 'Original Model.stl')
    await assets.write(legacyPath, new TextEncoder().encode('mesh'))
    await assets.write(destination, new TextEncoder().encode('different mesh'))
    const repository = migrationRepository(legacyPath)

    await expect(migrateAssetLayout(repository, assets)).rejects.toThrow('destination already exists')

    expect(repository.getRequest(requestId)?.filePath).toBe(legacyPath)
    expect(repository.getSetting(ASSET_LAYOUT_SETTING)).toBeUndefined()
    await expect(fs.promises.stat(path.join(root, 'todo'))).resolves.toBeDefined()
  })
})

function migrationRepository(filePath: string) {
  let request = {
    id: requestId,
    name: 'Original Model',
    fileName: 'Original Model.stl',
    filePath,
  } as PrintRequest
  const settings = new Map<string, unknown>()
  return {
    getRequest: (id: string) => (id === request.id ? request : undefined),
    getSetting: <T>(key: string) => settings.get(key) as T | undefined,
    listRequests: () => [request],
    setSetting: (key: string, value: unknown) => settings.set(key, value),
    updateRequestFilePath: (id: string, previousPath: string, nextPath: string) => {
      if (id !== request.id || previousPath !== request.filePath) return false
      request = { ...request, filePath: nextPath }
      return true
    },
  }
}
