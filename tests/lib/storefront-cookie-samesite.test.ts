import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guard: storefront (customer + business) SESSION cookies must use sameSite 'lax', never 'strict'.
// 'strict' withholds the cookie on top-level navigations that originate off-site (reload after an
// external/OAuth/payment redirect, an emailed link, some webviews), so the next /api/auth/me sees
// no user_sid and the storefront logs the user out on reload. This was a prod-only intermittent
// logout (prod sets Domain/secure; local did not reproduce it). Keep these cookies on 'lax' to
// match the logout and refresh-token cookies, which already use 'lax' for the same reason.
// Admin/owner/portal/staff cookies are intentionally NOT covered here (separate session model).

const ROOT = join(__dirname, '..', '..')
const STOREFRONT_SESSION_ROUTES = [
  'src/app/api/(public)/auth/login/route.ts',
  'src/app/api/(public)/auth/signup/route.ts',
  'src/app/api/(public)/auth/google/route.ts',
  'src/app/api/(public)/business/login/route.ts',
  'src/app/api/(public)/business/signup/route.ts',
  'src/app/api/(public)/business/google/route.ts',
]

describe('storefront session cookie sameSite', () => {
  for (const rel of STOREFRONT_SESSION_ROUTES) {
    it(`${rel} does not set sameSite: 'strict'`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src, `${rel} sets a session cookie with sameSite:'strict' — use 'lax' (see this test's header)`).not.toMatch(
        /sameSite:\s*['"]strict['"]/
      )
    })

    it(`${rel} sets sameSite: 'lax' on its session cookie(s)`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src).toMatch(/sameSite:\s*['"]lax['"]/)
    })
  }
})
