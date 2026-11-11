// Writes the Tauri updater feed manifest (latest.json) for one Windows release.
// Usage: node .github/scripts/updater-manifest.mjs <version> <setup.exe.sig> <setup.exe download URL> <out.json> [notes]
import { readFileSync, writeFileSync } from 'node:fs'

const [version, sigPath, url, outPath, notes] = process.argv.slice(2)
if (!version || !sigPath || !url || !outPath) {
  console.error('usage: updater-manifest.mjs <version> <sig file> <url> <out.json> [notes]')
  process.exit(2)
}
const signature = readFileSync(sigPath, 'utf8').trim()
if (!signature) {
  console.error(`empty signature file: ${sigPath}`)
  process.exit(1)
}
const manifest = {
  version,
  notes: notes ?? `Voice Check Bench ${version}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: { 'windows-x86_64': { signature, url } },
}
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest, null, 2))
