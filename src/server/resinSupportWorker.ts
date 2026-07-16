import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const WORKER_VERSION = 'prusa-2.9.6-b028299'
export type ResinSupportGeometry = { supports: Uint8Array; elevationMm: number }

const inFlight = new Map<string, Promise<ResinSupportGeometry>>()

export async function generateResinSupports(project: Uint8Array) {
  const workerUrl = process.env.RESIN_SUPPORT_WORKER_URL
  if (!workerUrl) throw new Response('resin support worker is not configured', { status: 503 })

  const digest = crypto.createHash('sha256').update(WORKER_VERSION).update(project).digest('hex')
  const cacheDirectory = path.join(path.resolve(process.env.DATA_DIR ?? '/data'), 'resin-support-cache')
  const cachePath = path.join(cacheDirectory, `${digest}.stl`)
  const metadataPath = path.join(cacheDirectory, `${digest}.json`)
  try {
    const [supports, metadata] = await Promise.all([fs.readFile(cachePath), fs.readFile(metadataPath, 'utf8')])
    try {
      const elevationMm = JSON.parse(metadata).elevationMm
      if (!supports.byteLength || typeof elevationMm !== 'number' || !Number.isFinite(elevationMm) || elevationMm < 0)
        throw new Error('invalid cached resin support data')
      return { supports: new Uint8Array(supports), elevationMm }
    } catch {
      await removeCachedSupport(cachePath, metadataPath)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await removeCachedSupport(cachePath, metadataPath)
  }

  const pending = inFlight.get(digest)
  if (pending) return pending
  const job = generateAndCache(project, cacheDirectory, cachePath, metadataPath).finally(() => inFlight.delete(digest))
  inFlight.set(digest, job)
  return job
}

async function generateAndCache(project: Uint8Array, cacheDirectory: string, cachePath: string, metadataPath: string) {
  const workerUrl = process.env.RESIN_SUPPORT_WORKER_URL!
  let response: Response
  try {
    const projectBody = new Uint8Array(project.byteLength)
    projectBody.set(project)
    response = await fetch(new URL('/supports', workerUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'model/3mf' },
      body: projectBody.buffer,
      signal: AbortSignal.timeout(20 * 60 * 1000),
    })
  } catch (error) {
    throw new Response(error instanceof Error ? error.message : 'resin support worker is unavailable', { status: 503 })
  }
  if (!response.ok) {
    const message = (await response.text()).trim()
    throw new Response(message || 'support generation failed', { status: response.status === 422 ? 422 : 502 })
  }

  const elevationHeader = response.headers.get('x-model-elevation')
  const elevationMm = elevationHeader === null ? Number.NaN : Number(elevationHeader)
  if (!Number.isFinite(elevationMm) || elevationMm < 0)
    throw new Response('support worker returned invalid elevation metadata', { status: 502 })
  const supports = new Uint8Array(await response.arrayBuffer())
  if (!supports.byteLength) throw new Response('support worker returned empty geometry', { status: 502 })
  await fs.mkdir(cacheDirectory, { recursive: true })
  const suffix = `${crypto.randomUUID()}.tmp`
  const temporaryCachePath = `${cachePath}.${suffix}`
  const temporaryMetadataPath = `${metadataPath}.${suffix}`
  await Promise.all([
    fs.writeFile(temporaryCachePath, supports, { mode: 0o600 }),
    fs.writeFile(temporaryMetadataPath, JSON.stringify({ elevationMm }), { mode: 0o600 }),
  ])
  await fs.rename(temporaryCachePath, cachePath)
  await fs.rename(temporaryMetadataPath, metadataPath)
  return { supports, elevationMm }
}

function removeCachedSupport(cachePath: string, metadataPath: string) {
  return Promise.all([fs.rm(cachePath, { force: true }), fs.rm(metadataPath, { force: true })])
}
