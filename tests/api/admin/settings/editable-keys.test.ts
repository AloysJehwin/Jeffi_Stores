import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROUTE = path.join(process.cwd(), 'src/app/api/admin/settings/route.ts')
const PAGE = path.join(process.cwd(), 'src/app/admin/settings/site-controls/page.tsx')

function editableKeys(): Set<string> {
  const src = fs.readFileSync(ROUTE, 'utf8')
  const block = src.slice(src.indexOf('const EDITABLE_KEYS = ['), src.indexOf('const EDITABLE_SET'))
  return new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]))
}

function keysRenderedByPage(): string[] {
  const src = fs.readFileSync(PAGE, 'utf8')
  return [...src.matchAll(/settingKey="([a-z0-9_]+)"/g)].map(m => m[1])
}

// A control the page renders but the API rejects fails with 400 "Setting not editable" only
// when a user toggles it — invisible until then. Three flags had drifted out this way.
describe('every setting the admin UI renders is writable through the API', () => {
  it('has no control missing from EDITABLE_KEYS', () => {
    const allowed = editableKeys()
    const missing = keysRenderedByPage().filter(k => !allowed.has(k))
    expect(missing).toEqual([])
  })

  it('reads a non-trivial number of controls (guards the regex)', () => {
    expect(keysRenderedByPage().length).toBeGreaterThanOrEqual(64)
  })
})
