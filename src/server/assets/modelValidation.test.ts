import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidThreeMfError, validateThreeMf, validateThreeMfFile } from './modelValidation'
import { ModelWorkerScheduler } from './modelWorkerScheduler'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

describe('validateThreeMfFile', () => {
  it('waits for scheduler admission before reading the upload', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-'))
    roots.push(root)
    const file = path.join(root, 'model.3mf')
    const scheduler = new ModelWorkerScheduler(1)
    let release!: () => void
    const blocked = scheduler.run(() => new Promise<void>((resolve) => (release = resolve)))
    const validation = validateThreeMfFile(file, { inline: true }, scheduler)

    await Promise.resolve()
    await fs.promises.writeFile(
      file,
      zipSync({
        '[Content_Types].xml': strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
        ),
        '_rels/.rels': strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        ),
        '3D/model.model': strToU8(
          '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
        ),
      }),
    )
    release()

    await expect(validation).resolves.toBeUndefined()
    await blocked
  })

  it('distinguishes invalid archives from storage failures', async () => {
    await expect(validateThreeMf(new TextEncoder().encode('not a zip'), { inline: true })).rejects.toBeInstanceOf(InvalidThreeMfError)
    await expect(validateThreeMfFile('/missing/model.3mf', { inline: true })).rejects.not.toBeInstanceOf(InvalidThreeMfError)
  })

  it('holds scheduler admission until worker termination completes', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-worker-'))
    roots.push(root)
    const workerPath = path.join(root, 'invalid-worker.mjs')
    await fs.promises.writeFile(workerPath, "throw new Error('worker crashed')")
    let releaseTermination!: (code: number) => void
    const termination = new Promise<number>((resolve) => (releaseTermination = resolve))
    const terminate = vi.spyOn(Worker.prototype, 'terminate').mockReturnValueOnce(termination)
    const scheduler = new ModelWorkerScheduler(1)
    let secondStarted = false
    const validation = validateThreeMf(new Uint8Array([1]), { path: workerPath }, scheduler)
    const second = scheduler.run(async () => {
      secondStarted = true
    })

    await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce())
    expect(secondStarted).toBe(false)
    releaseTermination(1)
    await expect(validation).rejects.toThrow('worker crashed')
    await second
    expect(secondStarted).toBe(true)
  })

  it('rejects a clean worker exit without a result and holds admission through termination', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-validation-worker-exit-'))
    roots.push(root)
    const workerPath = path.join(root, 'empty-worker.mjs')
    await fs.promises.writeFile(workerPath, '')
    let releaseTermination!: (code: number) => void
    const termination = new Promise<number>((resolve) => (releaseTermination = resolve))
    const terminate = vi.spyOn(Worker.prototype, 'terminate').mockReturnValueOnce(termination)
    const scheduler = new ModelWorkerScheduler(1)
    let secondStarted = false
    const validation = validateThreeMf(new Uint8Array([1]), { path: workerPath }, scheduler)
    const second = scheduler.run(async () => {
      secondStarted = true
    })

    await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce())
    expect(secondStarted).toBe(false)
    releaseTermination(0)
    await expect(validation).rejects.toThrow('exited with code 0 before returning a result')
    await second
    expect(secondStarted).toBe(true)
  })
})
