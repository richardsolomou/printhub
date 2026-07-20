import type { Repository, StorageConfig } from '../core/types'

type SettingsReader = { getSetting(key: string): unknown }

export function localStorageAllowed(repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  return process.env.PRINTHUB_HOSTED !== 'true' || repository.isSuperAdminWorkspace()
}

export function hostedStorageRequiresRemote(config: StorageConfig, repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  return config.adapter === 'local' && !localStorageAllowed(repository)
}

export function storageConfigured(repository: SettingsReader) {
  return repository.getSetting('storageEncrypted') !== undefined || repository.getSetting('storage') !== undefined
}

export function assertStorageAllowed(config: StorageConfig, repository: Pick<Repository, 'isSuperAdminWorkspace'>) {
  if (hostedStorageRequiresRemote(config, repository))
    throw new Response('local storage is limited to super admin workspaces', { status: 403 })
}
