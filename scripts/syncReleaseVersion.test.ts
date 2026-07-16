import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readReleaseVersions, syncReleaseVersion } from './syncReleaseVersion'

describe('syncReleaseVersion', () => {
  it('copies the package version into the TrueNAS manifest and image values', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    const valuesPath = path.join(directory, 'ix_values.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\napp_version: 0.17.0\nversion: 1.0.0\n')
    fs.writeFileSync(valuesPath, 'images:\n  image:\n    repository: example/printhub\n    tag: 0.16.0\n')

    syncReleaseVersion(packagePath, manifestPath, valuesPath)

    expect(fs.readFileSync(manifestPath, 'utf8')).toBe('annotations: {}\napp_version: 1.2.3\nversion: 1.0.0\n')
    expect(fs.readFileSync(valuesPath, 'utf8')).toBe('images:\n  image:\n    repository: example/printhub\n    tag: v1.2.3\n')
  })

  it('rejects a release file without its version field', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-release-'))
    const packagePath = path.join(directory, 'package.json')
    const manifestPath = path.join(directory, 'app.yaml')
    const valuesPath = path.join(directory, 'ix_values.yaml')
    fs.writeFileSync(packagePath, JSON.stringify({ version: '1.2.3' }))
    fs.writeFileSync(manifestPath, 'annotations: {}\n')
    fs.writeFileSync(valuesPath, 'images: {}\n')

    expect(() => syncReleaseVersion(packagePath, manifestPath, valuesPath)).toThrow('TrueNAS manifest must contain a version field')
  })

  it('keeps repository release versions consistent', () => {
    const versions = readReleaseVersions()
    expect(versions.manifest).toBe(versions.package)
    expect(versions.image).toBe(`v${versions.package}`)
  })
})
