// Once a day, ask npm for the latest @jeffi_erp/cli and mention it on stderr. JEFFI_NO_UPDATE_CHECK=1 or CI turns it off.
import fs from 'node:fs'
import path from 'node:path'
import { fetch } from 'undici'
import { compareVersions } from './commands/auth'
import { CLI_VERSION } from './util'

const DAY = 24 * 60 * 60 * 1000

export async function updateNotice(dir: string, env: NodeJS.ProcessEnv, now = Date.now()): Promise<string | null> {
  if (env.JEFFI_NO_UPDATE_CHECK || env.CI || CLI_VERSION.startsWith('0.0.0')) return null
  const file = path.join(dir, 'update-check.json')
  let state: { checkedAt?: number; latest?: string } = {}
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    /* first run */
  }
  if (!state.checkedAt || now - state.checkedAt > DAY) {
    try {
      const res = await fetch('https://registry.npmjs.org/@jeffi_erp/cli/latest', { signal: AbortSignal.timeout(1500) })
      if (res.ok) state.latest = ((await res.json()) as { version?: string }).version
    } catch {
      /* offline: try again tomorrow */
    }
    state.checkedAt = now
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(file, JSON.stringify(state))
    } catch {
      /* read-only home */
    }
  }
  return state.latest && compareVersions(CLI_VERSION, state.latest) < 0 ? `jeffi ${state.latest} is out (you have ${CLI_VERSION}): npm i -g @jeffi_erp/cli` : null
}
