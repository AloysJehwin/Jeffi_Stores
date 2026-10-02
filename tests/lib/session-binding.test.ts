import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webcrypto } from 'crypto'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), queryOne: vi.fn() }))

import * as db from '@/lib/shared/db'
import {
  mintBindCookie,
  verifyBindCookie,
  verifyProof,
  parsePublicJwk,
  evaluateKeyBinding,
  bindingMode,
  bindScope,
  BIND_COOKIE,
  canRegisterKey,
} from '@/lib/auth/session-binding'

const b64url = (b: ArrayBuffer) => Buffer.from(b).toString('base64url')

// Signs exactly the way the browser guard does (WebCrypto ECDSA, raw r||s signature).
async function browserKey() {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', kp.publicKey)
  const sign = async (method: string, path: string, ts = Date.now()) => {
    const nonce = b64url(webcrypto.getRandomValues(new Uint8Array(12)).buffer)
    const msg = new TextEncoder().encode(`${method}\n${path}\n${ts}\n${nonce}`)
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, msg)
    return `${ts.toString(36)}.${nonce}.${b64url(sig)}`
  }
  return { kp, jwk: parsePublicJwk(jwk)!, sign }
}

const SID_HASH = 'a'.repeat(64)
const HOST = 'shop.example.com'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SESSION_BINDING_SECRET = 'test-secret'
  process.env.SESSION_BINDING_MODE = 'enforce'
})

describe('binding cookie', () => {
  it('verifies only beside the sid and host it was minted for', () => {
    const { value } = mintBindCookie(SID_HASH, HOST)
    expect(verifyBindCookie(value, SID_HASH, HOST)).toBe(true)
    expect(verifyBindCookie(value, 'b'.repeat(64), HOST)).toBe(false)
    expect(verifyBindCookie(value, SID_HASH, 'other.example.com')).toBe(false)
    expect(verifyBindCookie(value + 'x', SID_HASH, HOST)).toBe(false)
    expect(verifyBindCookie(null, SID_HASH, HOST)).toBe(false)
  })

  it('rejects an expired cookie', () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const forged = `${past.toString(36)}.${mintBindCookie(SID_HASH, HOST).value.split('.')[1]}`
    expect(verifyBindCookie(forged, SID_HASH, HOST)).toBe(false)
  })
})

describe('signed proof', () => {
  it('accepts a browser-made signature and rejects any tampering', async () => {
    const { jwk, sign } = await browserKey()
    const proof = await sign('GET', '/api/orders/1')
    expect(verifyProof(jwk, proof, 'GET', '/api/orders/1').ok).toBe(true)
    expect(verifyProof(jwk, proof, 'POST', '/api/orders/1').ok).toBe(false)
    expect(verifyProof(jwk, proof, 'GET', '/api/orders/2').ok).toBe(false)
  })

  it('rejects a proof made by a different browser key', async () => {
    const victim = await browserKey()
    const attacker = await browserKey()
    const proof = await attacker.sign('GET', '/api/orders/1')
    expect(verifyProof(victim.jwk, proof, 'GET', '/api/orders/1').ok).toBe(false)
  })

  it('rejects a stale proof', async () => {
    const { jwk, sign } = await browserKey()
    const proof = await sign('GET', '/api/x', Date.now() - 10 * 60_000)
    expect(verifyProof(jwk, proof, 'GET', '/api/x').ok).toBe(false)
  })

  it('never accepts a private key as a public one', () => {
    expect(parsePublicJwk({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43), d: 'secret' })).toBeNull()
  })
})

describe('evaluateKeyBinding', () => {
  const base = { sessionId: 'sess-1', sidHash: SID_HASH, principalType: 'customer' as const }
  // Default to a mutation: proof is only ever required for script-made mutations, so the
  // proof-required paths are exercised with POST. Reads (GET/HEAD) are covered separately.
  const ctx = (over: Record<string, unknown>) => ({
    host: HOST,
    method: 'POST',
    path: '/api/orders/1',
    bindCookies: {},
    proof: null,
    fetchDest: 'empty',
    ...over,
  })

  it('a copied sid with no binding cookie is refused once a key is on file', async () => {
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({ public_jwk: jwk, bind_host: HOST } as any)
    const v = await evaluateKeyBinding({ ...base, ctx: ctx({}) as any })
    expect(v).toMatchObject({ status: 'violation', reason: 'cookie_missing', reject: true })
  })

  it('a fully copied cookie jar still fails API calls: it cannot sign', async () => {
    const victim = await browserKey()
    const attacker = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({ public_jwk: victim.jwk, bind_host: HOST } as any)
    const cookie = mintBindCookie(SID_HASH, HOST).value
    const proof = await attacker.sign('POST', '/api/orders/1')
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-2',
      ctx: ctx({ bindCookies: { [`customer`]: cookie }, proof }) as any,
    })
    expect(v).toMatchObject({ status: 'violation', reason: 'proof_invalid', reject: true })
  })

  it('the real browser passes', async () => {
    const victim = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({ public_jwk: victim.jwk, bind_host: HOST } as any)
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-3',
      ctx: ctx({
        bindCookies: { customer: mintBindCookie(SID_HASH, HOST).value },
        proof: await victim.sign('POST', '/api/orders/1'),
      }) as any,
    })
    expect(v).toEqual({ status: 'ok', reject: false })
  })

  it('monitor mode records the violation but refuses nothing', async () => {
    process.env.SESSION_BINDING_MODE = 'monitor'
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({ public_jwk: jwk, bind_host: HOST } as any)
    const v = await evaluateKeyBinding({ ...base, sessionId: 'sess-4', ctx: ctx({}) as any })
    expect(v).toMatchObject({ status: 'violation', reject: false })
  })

  it('a page load with a missing bind cookie is a violation but is NOT rejected', async () => {
    // A document navigation is judged before any page JS can (re)bind, and the bind cookie is
    // short-lived (BIND_TTL_S). Rejecting it logged active users out on reload. The violation is
    // still recorded, but reject must be false for a document navigation — the copied-cookie
    // protection lives on authenticated API calls (asserted in the next test).
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: jwk,
      bind_host: HOST,
      created_at: new Date(Date.now() - 60_000),
    } as any)
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-page',
      ctx: ctx({ path: '/admin/products', fetchDest: 'document' }) as any,
    })
    expect(v).toMatchObject({ status: 'violation', reason: 'cookie_missing', reject: false })
  })

  it('a read (GET) is never refused for a missing bind cookie, on any path (reload race)', async () => {
    // The storefront/admin "logged out on reload": every portal fires a read on page load (/me,
    // check-session, staff/me, ...) before the guard re-binds, so the call carries no bind cookie.
    // A read must never reject regardless of path, or the client reads 200 {user:null} as logged
    // out and tears the session down. This holds for probe routes AND any other GET, so a new
    // portal's probe is safe without being added to any list.
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: jwk,
      bind_host: HOST,
      created_at: new Date(Date.now() - 60_000),
    } as any)
    const reads = [
      '/api/auth/me',
      '/api/business/me',
      '/api/ecom/auth/me',
      '/api/staff/me',
      '/api/admin/check-session',
      '/api/orders/1',
    ]
    for (const path of reads) {
      const v = await evaluateKeyBinding({
        ...base,
        sessionId: 'sess-read',
        ctx: ctx({ method: 'GET', path, fetchDest: 'empty' }) as any,
      })
      expect(v, path).toMatchObject({ status: 'violation', reason: 'cookie_missing', reject: false })
    }
  })

  it('a copied sid IS refused on an authenticated API mutation (proof-required)', async () => {
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: jwk,
      bind_host: HOST,
      created_at: new Date(Date.now() - 60_000),
    } as any)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const v = await evaluateKeyBinding({
        ...base,
        sessionId: 'sess-api',
        ctx: ctx({ method, path: '/api/admin/products', fetchDest: 'empty' }) as any,
      })
      expect(v, method).toMatchObject({ status: 'violation', reject: true })
    }
  })

  it('requests already in flight when the key was registered are let through', async () => {
    const { jwk } = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: jwk,
      bind_host: HOST,
      created_at: new Date(Date.now() - 3000),
    } as any)
    const v = await evaluateKeyBinding({ ...base, sessionId: 'sess-grace', ctx: ctx({}) as any })
    expect(v).toEqual({ status: 'ok', reject: false })
  })

  it('that grace never covers a bad signature', async () => {
    const victim = await browserKey()
    const attacker = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: victim.jwk,
      bind_host: HOST,
      created_at: new Date(Date.now() - 3000),
    } as any)
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-grace-2',
      ctx: ctx({
        bindCookies: { customer: mintBindCookie(SID_HASH, HOST).value },
        proof: await attacker.sign('POST', '/api/orders/1'),
      }) as any,
    })
    expect(v).toMatchObject({ reason: 'proof_invalid', reject: true })
  })

  it('a just-created session with no key yet is let through so it can bind', async () => {
    vi.mocked(db.queryOne).mockResolvedValue(null as any)
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-5',
      sessionCreatedAt: Date.now() - 30_000,
      ctx: ctx({}) as any,
    })
    expect(v).toEqual({ status: 'unbound', reject: false })
  })

  it('an old session that never bound is refused: nobody may attach a key to it later', async () => {
    vi.mocked(db.queryOne).mockResolvedValue(null as any)
    const v = await evaluateKeyBinding({
      ...base,
      sessionId: 'sess-5b',
      sessionCreatedAt: Date.now() - 60 * 60_000,
      ctx: ctx({}) as any,
    })
    expect(v).toEqual({ status: 'unbound', reject: true })
    expect(canRegisterKey(Date.now() - 60 * 60_000)).toBe(false)
    expect(canRegisterKey(Date.now() - 30_000)).toBe(true)
  })

  it('an unreadable key table skips binding instead of locking users out', async () => {
    vi.mocked(db.queryOne).mockRejectedValue(new Error('relation "auth_session_keys" does not exist'))
    const v = await evaluateKeyBinding({ ...base, sessionId: 'sess-6', ctx: ctx({}) as any })
    expect(v).toEqual({ status: 'skipped', reject: false })
  })

  it('switches itself off when no server secret is configured', () => {
    delete process.env.SESSION_BINDING_SECRET
    const saved = [process.env.JWT_SECRET, process.env.CRON_SECRET]
    delete process.env.JWT_SECRET
    delete process.env.CRON_SECRET
    expect(bindingMode()).toBe('off')
    ;[process.env.JWT_SECRET, process.env.CRON_SECRET] = saved
  })

  it('uses plain cookie names', () => {
    expect(Object.values(BIND_COOKIE).every(n => !/sid|sess|auth|token/i.test(n))).toBe(true)
  })
})

// The *_sid session cookie is set with Domain=.jeffistores.in, so one session is sent to the apex
// and every subdomain. Binding must span exactly that domain, or a session bound on one host reads
// as host_mismatch on the next and the user is logged out on reload (the live bug). These assert the
// scope collapses to the shared cookie domain in production, and stays host-pinned elsewhere.
describe('bind scope across subdomains (shared cookie domain)', () => {
  const APEX = 'jeffistores.in'
  const SUB = 'business.jeffistores.in'
  const OTHER_SITE = 'tenant-shop.com'
  let savedNodeEnv: string | undefined
  let savedCookieDomain: string | undefined

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV
    savedCookieDomain = process.env.COOKIE_DOMAIN
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    process.env.COOKIE_DOMAIN = '.jeffistores.in'
  })

  const restore = () => {
    if (savedNodeEnv === undefined) delete (process.env as Record<string, string>).NODE_ENV
    else (process.env as Record<string, string>).NODE_ENV = savedNodeEnv
    if (savedCookieDomain === undefined) delete process.env.COOKIE_DOMAIN
    else process.env.COOKIE_DOMAIN = savedCookieDomain
  }

  it('a cookie minted on the apex verifies on a subdomain (the reload-logout regression)', () => {
    const { value } = mintBindCookie(SID_HASH, APEX)
    expect(verifyBindCookie(value, SID_HASH, SUB)).toBe(true)
    expect(verifyBindCookie(value, SID_HASH, APEX)).toBe(true)
    restore()
  })

  it('a bare host under the shared domain scopes to it, not the exact host', () => {
    expect(bindScope('admin.jeffistores.in', '.jeffistores.in')).toBe('jeffistores.in')
    expect(bindScope('jeffistores.in', '.jeffistores.in')).toBe('jeffistores.in')
    restore()
  })

  it('a host NOT under the shared domain (custom tenant domain) stays host-pinned', () => {
    const { value } = mintBindCookie(SID_HASH, OTHER_SITE)
    expect(verifyBindCookie(value, SID_HASH, OTHER_SITE)).toBe(true)
    expect(verifyBindCookie(value, SID_HASH, 'other.tenant-shop.com')).toBe(false)
    expect(bindScope(OTHER_SITE, '.jeffistores.in')).toBe(OTHER_SITE)
    restore()
  })

  it('no shared cookie domain (non-prod/localhost) → scope is the host, unchanged behavior', () => {
    expect(bindScope('shop.example.com', undefined)).toBe('shop.example.com')
    expect(bindScope('shop.example.com', null)).toBe('shop.example.com')
    restore()
  })

  it('the real browser passes across subdomains: key registered on apex, request on subdomain', async () => {
    const victim = await browserKey()
    // Legacy/new rows both collapse to the shared scope; here bind_host is the apex host.
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: victim.jwk,
      bind_host: APEX,
      created_at: new Date(Date.now() - 60_000),
    } as any)
    const v = await evaluateKeyBinding({
      sessionId: 'sess-sub',
      sidHash: SID_HASH,
      principalType: 'customer',
      ctx: {
        host: SUB,
        method: 'POST',
        path: '/api/orders/1',
        bindCookies: { customer: mintBindCookie(SID_HASH, SUB).value },
        proof: await victim.sign('POST', '/api/orders/1'),
        fetchDest: 'empty',
      } as any,
    })
    expect(v).toEqual({ status: 'ok', reject: false })
    restore()
  })

  it('a legacy key row pinned to a full subdomain host still matches after rollout', async () => {
    const victim = await browserKey()
    vi.mocked(db.queryOne).mockResolvedValue({
      public_jwk: victim.jwk,
      bind_host: 'admin.jeffistores.in', // registered before scope change
      created_at: new Date(Date.now() - 60_000),
    } as any)
    const v = await evaluateKeyBinding({
      sessionId: 'sess-legacy',
      sidHash: SID_HASH,
      principalType: 'customer',
      ctx: {
        host: APEX,
        method: 'POST',
        path: '/api/orders/1',
        bindCookies: { customer: mintBindCookie(SID_HASH, APEX).value },
        proof: await victim.sign('POST', '/api/orders/1'),
        fetchDest: 'empty',
      } as any,
    })
    expect(v).toEqual({ status: 'ok', reject: false })
    restore()
  })
})
