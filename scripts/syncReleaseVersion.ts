import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_VERSION_FIELD = /^app_version:[ \t]*(\S+)[ \t]*$/m
const IMAGE_TAG_FIELD = /^(\s{4}tag:)[ \t]*(\S+)[ \t]*$/m

function packageVersion(packagePath: string) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string') throw new Error('package.json must contain a version')
  return packageJson.version
}

function requiredVersion(filePath: string, pattern: RegExp, label: string) {
  const match = pattern.exec(fs.readFileSync(filePath, 'utf8'))
  if (!match?.[match.length - 1]) throw new Error(`${label} must contain a version field`)
  return match[match.length - 1]
}

function replaceVersion(filePath: string, pattern: RegExp, replacement: string, label: string) {
  const contents = fs.readFileSync(filePath, 'utf8')
  if (!pattern.test(contents)) throw new Error(`${label} must contain a version field`)
  fs.writeFileSync(filePath, contents.replace(pattern, replacement))
}

export function readReleaseVersions(
  packagePath = path.resolve('package.json'),
  manifestPath = path.resolve('deploy/truenas/printhub/app.yaml'),
  valuesPath = path.resolve('deploy/truenas/printhub/ix_values.yaml'),
) {
  return {
    package: packageVersion(packagePath),
    manifest: requiredVersion(manifestPath, APP_VERSION_FIELD, 'TrueNAS manifest'),
    image: requiredVersion(valuesPath, IMAGE_TAG_FIELD, 'TrueNAS image values'),
  }
}

export function syncReleaseVersion(
  packagePath = path.resolve('package.json'),
  manifestPath = path.resolve('deploy/truenas/printhub/app.yaml'),
  valuesPath = path.resolve('deploy/truenas/printhub/ix_values.yaml'),
) {
  const version = packageVersion(packagePath)
  replaceVersion(manifestPath, APP_VERSION_FIELD, `app_version: ${version}`, 'TrueNAS manifest')
  replaceVersion(valuesPath, IMAGE_TAG_FIELD, `$1 v${version}`, 'TrueNAS image values')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) syncReleaseVersion()
