import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { materializeBackupDirectory } from '../src/server/recoveryArchive'
import { verifyBackupBundle } from '../src/server/recovery'

const options = new Command()
  .name('restore-backup')
  .description('Verify and restore a PrintHub recovery bundle into empty data and print directories.')
  .requiredOption('--bundle <directory>', 'backup bundle directory')
  .requiredOption('--data <directory>', 'empty destination for printhub.sqlite and the integration key')
  .requiredOption('--prints <directory>', 'empty destination for restored print assets')
  .parse()
  .opts<{ bundle: string; data: string; prints: string }>()

const bundle = path.resolve(options.bundle)
const data = path.resolve(options.data)
const prints = path.resolve(options.prints)
for (const destination of [data, prints]) {
  fs.mkdirSync(destination, { recursive: true })
  if (fs.readdirSync(destination).length) throw new Error(`restore destination must be empty: ${destination}`)
}
await verifyBackupBundle(bundle)
const materialized = await materializeBackupDirectory(bundle)
try {
  fs.copyFileSync(path.join(materialized.directory, 'printhub.sqlite'), path.join(data, 'printhub.sqlite'))
  const key = path.join(materialized.directory, 'integration-secrets.key')
  if (fs.existsSync(key)) fs.copyFileSync(key, path.join(data, 'integration-secrets.key'))
  const assets = path.join(materialized.directory, 'assets')
  if (fs.existsSync(assets)) fs.cpSync(assets, prints, { recursive: true })
  console.log(`restored verified backup into ${data} and ${prints}`)
} finally {
  await materialized.cleanup()
}
