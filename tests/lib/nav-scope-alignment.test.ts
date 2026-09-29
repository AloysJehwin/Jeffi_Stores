import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { getScopeForPath, ADMIN_SCOPES } from '@/lib/scopes'

const LAYOUT = path.join(process.cwd(), 'src/app/admin/layout.tsx')

function navLinks(): { href: string; scope: string }[] {
  const src = fs.readFileSync(LAYOUT, 'utf8')
  return [...src.matchAll(/\{ href: '(\/admin\/[^']*)', label: '[^']*', scope: '([a-z0-9_]+:(?:read|write))'/g)]
    .map(m => ({ href: m[1], scope: m[2] }))
}

/**
 * A nav link gated on a different scope than the page itself shows a tenant a link their plan
 * does not include. Seven did — CRM on customers:read, Returns on orders:read and so on — all
 * of which are Basic-plan scopes, so a Basic store saw pages it had not bought.
 */
describe('a nav link is gated on the same scope as the page it points at', () => {
  it('reads a meaningful number of links (guards the regex)', () => {
    expect(navLinks().length).toBeGreaterThanOrEqual(47)
  })

  it('never gates a link on a different scope than its own route', () => {
    const mismatched = navLinks()
      .map(l => ({ ...l, pageScope: getScopeForPath(l.href) }))
      .filter(l => l.pageScope && l.pageScope !== l.scope
        // A write-scoped link over a read-scoped page is a deliberate tightening.
        && l.scope !== l.pageScope.replace(':read', ':write'))
    expect(mismatched).toEqual([])
  })

  it('only uses scopes that actually exist', () => {
    const keys = new Set(ADMIN_SCOPES.map(s => s.key))
    for (const l of navLinks()) expect(keys.has(l.scope), l.href).toBe(true)
  })
})

/**
 * getScopeForPath matched /api/admin/merchant-sync, a path that does not exist — the routes
 * live under /api/admin/merchant — so ten handlers sat behind no middleware scope check and
 * only their own products:* gate, which every plan has.
 */
describe('every admin API directory resolves to a scope', () => {
  const dirs = ['merchant', 'social-posts', 'returns', 'replacements', 'crm', 'tasks', 'traffic']

  it('maps each feature directory to a scope', () => {
    const unmapped = dirs.filter(d => !getScopeForPath(`/api/admin/${d}/anything`))
    expect(unmapped).toEqual([])
  })

  it('does not fall back to a Basic-plan scope for a higher-tier feature', () => {
    const BASIC_ONLY = ['products:read', 'orders:read', 'customers:read', 'dashboard:read']
    for (const d of ['merchant', 'returns', 'traffic']) {
      expect(BASIC_ONLY, d).not.toContain(getScopeForPath(`/api/admin/${d}/x`))
    }
  })
})
