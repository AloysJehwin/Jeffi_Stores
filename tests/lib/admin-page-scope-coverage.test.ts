import { describe, it, expect } from 'vitest'
import glob from 'fast-glob'
import { getScopeForPath } from '@/lib/auth/scopes'

/**
 * Middleware gates a page with getScopeForPath. A page whose path matches no scope's `routes`
 * resolves to null and is therefore not gated at all — and most admin pages are server
 * components that query directly, so the /api/admin gate does not cover them either.
 *
 * Eight pages were in that state: cash-sale, social-posts, the supplier detail/edit/new pages
 * and ecom/store-status.
 */
const SPECIAL_CASED = new Set([
  '/admin', // getScopeForPath returns dashboard:read explicitly
  '/admin/login', // pre-auth, deliberately null
  '/admin/team', // owner-only: the page redirects on !isPlatformOwner, which no scope expresses
])

function adminPages(): string[] {
  return glob.sync('src/app/\\(admin\\)/admin/**/page.tsx', { cwd: process.cwd() }).map(
    f =>
      '/' +
      f
        .replace('src/app/', '')
        .replace(/\/page\.tsx$/, '')
        .replace(/^\([^)]*\)\//, '')
        .replace(/\/\([^)]*\)/g, '')
  )
}

describe('every admin page resolves to a scope middleware can enforce', () => {
  it('finds the admin pages (guards the glob)', () => {
    expect(adminPages().length).toBeGreaterThanOrEqual(93)
  })

  it('leaves no page ungated', () => {
    const ungated = adminPages()
      .filter(p => !SPECIAL_CASED.has(p))
      // A dynamic segment resolves through its parent route prefix.
      .filter(p => !getScopeForPath(p.replace(/\[[^\]]+\]/g, 'x')))
      .sort()
    expect(ungated).toEqual([])
  })

  it('still resolves the dashboard and refuses the login page', () => {
    expect(getScopeForPath('/admin')).toBe('dashboard:read')
    expect(getScopeForPath('/admin/login')).toBeNull()
  })
})
