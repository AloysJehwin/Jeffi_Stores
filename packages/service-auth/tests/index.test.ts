import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  signServiceToken,
  verifyServiceToken,
  bearer,
  GATEWAY_HEADER,
  gatewayConfigured,
  signGatewayToken,
  verifyGatewayToken,
  type ServiceClaims,
  type GatewayClaims,
} from '../src/index'

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')

// gatewayKey() falls back to `dev-only:${SERVICE_AUTH_SECRET}` outside production,
// so tests can forge a token with the expected key.
const devGatewayKey = () =>
  createHmac('sha256', `dev-only:${process.env.SERVICE_AUTH_SECRET}`).update('jeffi-admin-gateway-v1').digest()

function forgeGateway(claims: Record<string, unknown>, key = devGatewayKey()): string {
  const payload = JSON.stringify(claims)
  const sig = createHmac('sha256', key).update(payload).digest()
  return `${b64(payload)}.${b64(sig)}`
}

const baseGateway: Omit<GatewayClaims, 'exp' | 'aud'> = {
  tenantId: '00000000-0000-0000-0000-000000000000',
  kind: 'cli',
  adminId: 'adm_1',
  scopes: ['*'],
  tokenId: 'tok_1',
  host: 'admin.store.test',
}

describe('signServiceToken / verifyServiceToken round-trip', () => {
  it('signs and verifies a valid token with claims intact', () => {
    const token = signServiceToken({ service: 'messaging', tenantId: 't1', scopes: ['send'] })
    const claims = verifyServiceToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.service).toBe('messaging')
    expect(claims!.tenantId).toBe('t1')
    expect(claims!.scopes).toEqual(['send'])
    expect(typeof claims!.exp).toBe('number')
  })

  it('carries optional claims verbatim', () => {
    const token = signServiceToken({
      service: 'documents',
      tenantId: 't2',
      internal: true,
      adminId: 'a1',
      userId: 'u1',
      role: 'owner',
      space: 'api',
      senderTenant: 'ecom',
      apiKeyId: 'key_1',
      tenantSlug: 'acme',
    })
    const claims = verifyServiceToken(token) as ServiceClaims
    expect(claims.internal).toBe(true)
    expect(claims.adminId).toBe('a1')
    expect(claims.userId).toBe('u1')
    expect(claims.role).toBe('owner')
    expect(claims.space).toBe('api')
    expect(claims.senderTenant).toBe('ecom')
    expect(claims.apiKeyId).toBe('key_1')
    expect(claims.tenantSlug).toBe('acme')
  })
})

describe('verifyServiceToken rejection branches', () => {
  it('rejects an undefined / empty token', () => {
    expect(verifyServiceToken(undefined)).toBeNull()
    expect(verifyServiceToken('')).toBeNull()
  })

  it('rejects a malformed token with no dot', () => {
    expect(verifyServiceToken('garbage')).toBeNull()
  })

  it('rejects a token missing the signature half', () => {
    expect(verifyServiceToken(`${b64('{}')}.`)).toBeNull()
  })

  it('rejects a token missing the payload half', () => {
    expect(verifyServiceToken(`.${b64('sig')}`)).toBeNull()
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signServiceToken({ service: 'messaging', tenantId: 't1' })
    const [, sig] = token.split('.')
    const forgedPayload = b64(JSON.stringify({ service: 'evil', tenantId: 'x', exp: Math.floor(Date.now() / 1000) + 60 }))
    expect(verifyServiceToken(`${forgedPayload}.${sig}`)).toBeNull()
  })

  it('rejects a token signed with the wrong secret', () => {
    const payload = JSON.stringify({ service: 'm', tenantId: 't', exp: Math.floor(Date.now() / 1000) + 60 })
    const sig = createHmac('sha256', 'not-the-secret').update(payload).digest()
    expect(verifyServiceToken(`${b64(payload)}.${b64(sig)}`)).toBeNull()
  })

  it('rejects a signature of the wrong length (length guard before timingSafeEqual)', () => {
    const token = signServiceToken({ service: 'm', tenantId: 't' })
    const [p] = token.split('.')
    expect(verifyServiceToken(`${p}.${b64('short')}`)).toBeNull()
  })

  it('rejects an expired token', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const token = signServiceToken({ service: 'm', tenantId: 't' }, 60)
      vi.setSystemTime(new Date('2026-01-01T00:02:00Z')) // +120s, past the 60s ttl
      expect(verifyServiceToken(token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a token still within its ttl', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const token = signServiceToken({ service: 'm', tenantId: 't' }, 60)
      vi.setSystemTime(new Date('2026-01-01T00:00:30Z')) // +30s, within ttl
      expect(verifyServiceToken(token)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SERVICE_AUTH_SECRET guard', () => {
  it('throws when signing without a secret', () => {
    const prev = process.env.SERVICE_AUTH_SECRET
    delete process.env.SERVICE_AUTH_SECRET
    try {
      expect(() => signServiceToken({ service: 'm', tenantId: 't' })).toThrow(/SERVICE_AUTH_SECRET is not set/)
    } finally {
      process.env.SERVICE_AUTH_SECRET = prev
    }
  })
})

describe('bearer', () => {
  it('extracts the token after a case-insensitive Bearer prefix', () => {
    expect(bearer({ headers: { authorization: 'Bearer abc.def' } })).toBe('abc.def')
    expect(bearer({ headers: { authorization: 'bearer xyz' } })).toBe('xyz')
  })

  it('trims surrounding whitespace', () => {
    expect(bearer({ headers: { authorization: 'Bearer   spaced  ' } })).toBe('spaced')
  })

  it('uses the first value when the header is an array', () => {
    expect(bearer({ headers: { authorization: ['Bearer first', 'Bearer second'] } })).toBe('first')
  })

  it('returns undefined for a missing or non-bearer header', () => {
    expect(bearer({ headers: {} })).toBeUndefined()
    expect(bearer({ headers: { authorization: 'Basic abc' } })).toBeUndefined()
    expect(bearer({ headers: { authorization: undefined } })).toBeUndefined()
  })
})

describe('gateway config', () => {
  it('exposes the header name and reports configured in dev fallback', () => {
    expect(GATEWAY_HEADER).toBe('x-jeffi-gateway')
    expect(gatewayConfigured()).toBe(true)
  })
})

describe('signGatewayToken / verifyGatewayToken round-trip', () => {
  it('signs and verifies, stamping aud and exp', () => {
    const token = signGatewayToken(baseGateway)
    const claims = verifyGatewayToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.aud).toBe('admin-gateway')
    expect(claims!.kind).toBe('cli')
    expect(claims!.scopes).toEqual(['*'])
    expect(claims!.tokenId).toBe('tok_1')
    expect(typeof claims!.exp).toBe('number')
  })

  it('verifies an extension-kind token (adminId required)', () => {
    const token = signGatewayToken({ ...baseGateway, kind: 'extension' })
    expect(verifyGatewayToken(token)).not.toBeNull()
  })

  it('verifies a service_account token (serviceAccountId required, no adminId)', () => {
    const token = signGatewayToken({
      ...baseGateway,
      kind: 'service_account',
      adminId: undefined,
      serviceAccountId: 'sa_1',
    })
    const claims = verifyGatewayToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.serviceAccountId).toBe('sa_1')
  })

  it('carries the platform flag through', () => {
    const token = signGatewayToken({ ...baseGateway, platform: true })
    expect(verifyGatewayToken(token)!.platform).toBe(true)
  })
})

describe('verifyGatewayToken rejection branches', () => {
  it('rejects null / undefined / empty', () => {
    expect(verifyGatewayToken(null)).toBeNull()
    expect(verifyGatewayToken(undefined)).toBeNull()
    expect(verifyGatewayToken('')).toBeNull()
  })

  it('rejects an oversized token (> 8192 chars)', () => {
    expect(verifyGatewayToken('a'.repeat(8193))).toBeNull()
  })

  it('rejects a token with the wrong number of segments', () => {
    expect(verifyGatewayToken('only-one-part')).toBeNull()
    expect(verifyGatewayToken('a.b.c')).toBeNull() // extra segment
  })

  it('rejects a signature-length mismatch', () => {
    const token = signGatewayToken(baseGateway)
    const [p] = token.split('.')
    expect(verifyGatewayToken(`${p}.${b64('short')}`)).toBeNull()
  })

  it('rejects a wrong signature of correct length', () => {
    const token = forgeGateway(
      { ...baseGateway, aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + 60 },
      createHmac('sha256', 'wrong-key').update('jeffi-admin-gateway-v1').digest()
    )
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = forgeGateway({ ...baseGateway, aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) - 1 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects a wrong audience', () => {
    const token = forgeGateway({ ...baseGateway, aud: 'something-else', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects a non-numeric exp', () => {
    const token = forgeGateway({ ...baseGateway, aud: 'admin-gateway', exp: 'soon' })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects when tenantId is not a string', () => {
    const token = forgeGateway({ ...baseGateway, tenantId: 123, aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects when tokenId is not a string', () => {
    const token = forgeGateway({ ...baseGateway, tokenId: null, aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects when scopes is not an array', () => {
    const token = forgeGateway({ ...baseGateway, scopes: 'all', aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects an unknown kind', () => {
    const token = forgeGateway({ ...baseGateway, kind: 'root', aud: 'admin-gateway', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects a cli/extension token missing adminId', () => {
    const token = forgeGateway({
      ...baseGateway,
      adminId: undefined,
      aud: 'admin-gateway',
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects a service_account token missing serviceAccountId', () => {
    const token = forgeGateway({
      ...baseGateway,
      kind: 'service_account',
      adminId: undefined,
      aud: 'admin-gateway',
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    expect(verifyGatewayToken(token)).toBeNull()
  })

  it('rejects a payload that is not valid base64url JSON', () => {
    // valid base64url but not JSON → JSON.parse throws, caught → null
    const key = devGatewayKey()
    const p = b64('not json at all {')
    const sig = createHmac('sha256', key).update('not json at all {').digest()
    expect(verifyGatewayToken(`${p}.${b64(sig)}`)).toBeNull()
  })
})

describe('scope matrix (full grant vs narrow)', () => {
  // The module carries scopes verbatim; callers enforce. Assert the data the
  // enforcement reads is faithfully round-tripped for both grant shapes.
  it('round-trips a full grant ["*"]', () => {
    const token = signGatewayToken({ ...baseGateway, scopes: ['*'] })
    expect(verifyGatewayToken(token)!.scopes).toEqual(['*'])
  })

  it('round-trips a narrow scope set', () => {
    const token = signGatewayToken({ ...baseGateway, scopes: ['orders:read', 'orders:write'] })
    expect(verifyGatewayToken(token)!.scopes).toEqual(['orders:read', 'orders:write'])
  })

  it('round-trips service-token scopes', () => {
    const token = signServiceToken({ service: 'm', tenantId: 't', scopes: ['*'] })
    expect(verifyServiceToken(token)!.scopes).toEqual(['*'])
    const narrow = signServiceToken({ service: 'm', tenantId: 't', scopes: ['send:sms'] })
    expect(verifyServiceToken(narrow)!.scopes).toEqual(['send:sms'])
  })
})

describe('gatewayKey env branches', () => {
  let prevGw: string | undefined
  let prevNode: string | undefined
  let prevSvc: string | undefined

  beforeEach(() => {
    prevGw = process.env.ADMIN_GATEWAY_SECRET
    prevNode = process.env.NODE_ENV
    prevSvc = process.env.SERVICE_AUTH_SECRET
  })

  afterEach(() => {
    if (prevGw === undefined) delete process.env.ADMIN_GATEWAY_SECRET
    else process.env.ADMIN_GATEWAY_SECRET = prevGw
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
    if (prevSvc === undefined) delete process.env.SERVICE_AUTH_SECRET
    else process.env.SERVICE_AUTH_SECRET = prevSvc
  })

  it('uses an explicit ADMIN_GATEWAY_SECRET when set', () => {
    process.env.ADMIN_GATEWAY_SECRET = 'explicit-gw-secret'
    expect(gatewayConfigured()).toBe(true)
    const token = signGatewayToken(baseGateway)
    const claims = verifyGatewayToken(token)
    expect(claims).not.toBeNull()
  })

  it('reports not configured and verify returns null when no secret resolves (production, no gateway secret)', () => {
    delete process.env.ADMIN_GATEWAY_SECRET
    process.env.NODE_ENV = 'production'
    delete process.env.SERVICE_AUTH_SECRET
    expect(gatewayConfigured()).toBe(false)
    expect(verifyGatewayToken('a.b')).toBeNull()
    expect(() => signGatewayToken(baseGateway)).toThrow(/ADMIN_GATEWAY_SECRET is not set/)
  })
})
