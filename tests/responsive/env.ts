import fs from 'node:fs'
import path from 'node:path'

/** Loads .env.local (+ overrides) into process.env without printing anything; existing values win. */
export function loadLocalEnv(root = process.cwd()) {
  for (const name of ['.env.local', '.env.local.overrides']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
      if (!m || process.env[m[1]] !== undefined) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}
