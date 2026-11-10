// Decode a Settings.json copy with the repo's TypeScript codec (src/wavelink/codec.ts). Read-only.
// Usage (from the repo root): npx tsx spike/vst2-host/scripts/decode-ts.ts spike/vst2-host/out/Settings.modified.json
import { readFileSync } from 'node:fs'
import { parseSettings } from '../../../src/wavelink/codec'

const file = parseSettings(readFileSync(process.argv[2], 'utf8'))
const mic = file.inputs[0]
console.log('input', mic.key)
for (const p of mic.plugins) {
  if (p.state.kind === 'opaque') continue
  console.log(p.name, JSON.stringify(p.state))
}
