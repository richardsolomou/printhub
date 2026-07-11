import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { LocalAuthProvider, TrustedHeaderAuthProvider } from '../adapters/auth'
import { LocalEventBus } from '../adapters/events'
import { OptionalPostHogTelemetry } from '../adapters/telemetry'
import { PrintHubService } from '../core/services'

const singleton = globalThis as typeof globalThis & { __printhub?: ReturnType<typeof createApp> }

async function createApp() {
  let repository: SqliteRepository | undefined
  try {
    repository = SqliteRepository.open()
    const assets = new LocalAssetStore()
    await assets.initialize()
    const events = new LocalEventBus()
    const telemetry = new OptionalPostHogTelemetry()
    const auth = process.env.AUTH_PROVIDER === 'trusted-header'
      ? new TrustedHeaderAuthProvider(repository)
      : new LocalAuthProvider(repository)
    const service = new PrintHubService(repository, assets, events, telemetry)
    await service.recoverOperations()
    repository.reconcileWorkflow()
    for (const uploadId of repository.expireUploads(Date.now())) {
      await Promise.allSettled([
        import('node:fs').then(({ promises }) => promises.rm(assets.uploadPart(uploadId), { force: true })),
        import('node:fs').then(({ promises }) => promises.rm(assets.uploadPreviewPart(uploadId), { force: true })),
      ])
    }
    await assets.sweepUploads(repository.activeUploadIds(Date.now()))
    await assets.sweepTrash()
    return { repository, assets, events, telemetry, auth, service }
  } catch (error) {
    repository?.close()
    throw error
  }
}

export function app() {
  if (singleton.__printhub) return singleton.__printhub
  const pending = createApp()
  singleton.__printhub = pending
  void pending.catch(() => {
    if (singleton.__printhub === pending) delete singleton.__printhub
  })
  return pending
}
