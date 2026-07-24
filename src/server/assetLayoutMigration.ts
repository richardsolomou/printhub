import { createAssetKey } from '../core/assetKeys'
import type { AssetStore, PrintRequest, Repository } from '../core/types'
import { logger } from './logger'

export const ASSET_LAYOUT_SETTING = 'asset-layout-version'
export const ASSET_LAYOUT_VERSION = 1
const LEGACY_MODEL_DIRECTORIES = ['todo', 'up-next', 'in-progress', 'post-processing', 'done']

type AssetLayoutRepository = Pick<Repository, 'getRequest' | 'getSetting' | 'listRequests' | 'setSetting' | 'updateRequestFilePath'>

export async function migrateAssetLayout(repository: AssetLayoutRepository, assets: AssetStore) {
  if (repository.getSetting<number>(ASSET_LAYOUT_SETTING) === ASSET_LAYOUT_VERSION) return

  let migrated = 0
  for (const request of repository.listRequests()) {
    const destinationPath = stablePath(request)
    if (request.filePath === destinationPath) continue
    await assets.ensureMoved(request.filePath, destinationPath)
    if (!repository.updateRequestFilePath(request.id, request.filePath, destinationPath)) {
      const current = repository.getRequest(request.id)
      if (current?.filePath !== destinationPath) throw new Error(`request asset path changed during migration: ${request.id}`)
    }
    migrated++
  }

  for (const directory of LEGACY_MODEL_DIRECTORIES) await assets.removeDirectory(directory)
  repository.setSetting(ASSET_LAYOUT_SETTING, ASSET_LAYOUT_VERSION)
  logger.info({ migrated }, 'stable asset layout migration completed')
}

function stablePath(request: Pick<PrintRequest, 'fileName' | 'id'>) {
  return createAssetKey(request.id, request.fileName)
}
