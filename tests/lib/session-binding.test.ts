import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webcrypto } from 'crypto'

vi.mock('@/lib/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), queryOne: vi.fn() }))

import * as db from '@/lib/db'
import {
  mintBindCookie,
  verifyBindCookie,
  verifyProof,
  parsePublicJwk,
  evaluateKeyBinding,
  bindingMode,
  BIND_COOKIE,
  canRegisterKey,
} from '@/lib/session-binding'

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
  const ctx = (over: Record<string, unknown>) => ({
    host: HOST,
    method: 'GET',
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
    const proof = await attacker.sign('GET', '/api/orders/1')
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
        proof: await victim.sign('GET', '/api/orders/1'),
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

  it('a page load with a copied sid is refused too, not just API calls', async () => {
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
    expect(v).toMatchObject({ status: 'violation', reason: 'cookie_missing', reject: true })
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
        proof: await attacker.sign('GET', '/api/orders/1'),
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
