import { SqliteRepository } from '../adapters/sqlite'
import { LocalAssetStore } from '../adapters/filesystem'
import { UploadStaging } from '../adapters/staging'
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
    const staging = new UploadStaging()
    await staging.initialize()
    const events = new LocalEventBus()
    const telemetry = new OptionalPostHogTelemetry()
    const auth = process.env.AUTH_PROVIDER === 'trusted-header'
      ? new TrustedHeaderAuthProvider(repository)
      : new LocalAuthProvider(repository)
    const service = new PrintHubService(repository, assets, staging, events, telemetry)
    await service.recoverOperations()
    repository.reconcileWorkflow()
    for (const uploadId of repository.expireUploads(Date.now())) {
      await Promise.allSettled([
        staging.remove(staging.uploadPart(uploadId)),
        staging.remove(staging.uploadPreviewPart(uploadId)),
      ])
    }
    await staging.sweepUploads(repository.activeUploadIds(Date.now()))
    await assets.sweepTrash()
    return { repository, assets, staging, events, telemetry, auth, service }
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
