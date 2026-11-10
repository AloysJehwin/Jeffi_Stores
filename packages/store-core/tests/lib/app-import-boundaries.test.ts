import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

// Each app may import store-core (@/) and its own code, never another app's. Store pods ship without
// the controller, so store-core and the storefront/admin/business apps must not reach @controller/*.
// Tests are held to the same rule: a test that needs another app's code belongs in that app.
// ESLint enforces this on src; this also covers tests and integration-tests, which next lint skips.

const ROOT = join(__dirname, '..', '..', '..', '..')
const APPS = ['controller', 'storefront', 'admin', 'business'] as const
const SPEC_RE = /(['"`])@(controller|storefront|admin|business)\/[^'"`]*\1/g

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (name === 'node_modules' || name === '.next') return []
    try {
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : []
    } catch {
      return [] // a build/test artifact removed mid-walk under a loaded shard; skip it
    }
  })
}

const trees: { owner: (typeof APPS)[number] | 'store-core'; dirs: string[] }[] = [
  { owner: 'store-core', dirs: ['packages/store-core/src', 'packages/store-core/tests', 'packages/store-core/integration-tests'] },
  ...APPS.map(a => ({ owner: a, dirs: [`${a}-service/src`, `${a}-service/tests`, `${a}-service/integration-tests`] })),
]

describe('app import boundaries', () => {
  for (const { owner, dirs } of trees) {
    it(`${owner} imports no other app`, () => {
      const offenders: string[] = []
      for (const file of dirs.flatMap(d => walk(join(ROOT, d)))) {
        let src: string
        try {
          src = readFileSync(file, 'utf8')
        } catch {
          continue // removed mid-run; nothing to check
        }
        for (const m of src.matchAll(SPEC_RE)) {
          if (m[2] !== owner) offenders.push(`${relative(ROOT, file)}: ${m[0]}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }
})
