import path from 'node:path'
import { Command } from 'commander'
import { verifyBackupBundle } from '../src/server/recovery'

const options = new Command()
  .name('verify-backup')
  .description('Verify a PrintHub recovery bundle and every included checksum.')
  .requiredOption('--bundle <directory>', 'backup bundle directory')
  .parse()
  .opts<{ bundle: string }>()

const directory = path.resolve(options.bundle)
const manifest = await verifyBackupBundle(directory)
console.log(`verified ${directory}: ${manifest.assets.length} assets, database integrity ok`)
