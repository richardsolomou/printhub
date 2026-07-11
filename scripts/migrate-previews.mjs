// One-time migration: generate decimated previews for jobs uploaded before
// previews existed. Run from a machine that can reach the app directly
// (dev server or NAS LAN address) — delete after running against prod.
//
//   node scripts/migrate-previews.mjs http://<host>:<port> [email]
//
// The email is stamped into the Cf-Access header (LAN/dev only; the tunnel
// injects the real one and won't pass ours through).
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api.js'
import { generateAssets } from '../src/lib/assetPipeline.ts'

const [base, email = 'rsolomou@gmail.com'] = process.argv.slice(2)
if (!base) {
  console.error('usage: node scripts/migrate-previews.mjs http://<host>:<port> [email]')
  process.exit(1)
}
const headers = { 'Cf-Access-Authenticated-User-Email': email }

const convexUrl = process.env.CONVEX_URL
if (!convexUrl) {
  console.error('set CONVEX_URL to the deployment the app uses')
  process.exit(1)
}
const convex = new ConvexHttpClient(convexUrl)

const jobs = await convex.query(api.jobs.list, {})
const missing = jobs.filter((job) => !job.previewPath)
console.log(`${jobs.length} jobs, ${missing.length} without previews`)

for (const job of missing) {
  process.stdout.write(`${job.name} … `)
  const res = await fetch(`${base}/api/files/${job._id}?inline=1`, { headers })
  if (!res.ok) {
    console.log(`SKIP (download ${res.status})`)
    continue
  }
  const { previewBytes } = await generateAssets(await res.arrayBuffer())
  if (!previewBytes) {
    console.log('skip (no worthwhile preview)')
    continue
  }
  const post = await fetch(`${base}/api/preview/${job._id}`, { method: 'POST', headers, body: previewBytes })
  console.log(post.ok ? `done (${Math.round(previewBytes.byteLength / 1e6)} MB preview)` : `FAILED (${post.status})`)
}
console.log('migration complete')
