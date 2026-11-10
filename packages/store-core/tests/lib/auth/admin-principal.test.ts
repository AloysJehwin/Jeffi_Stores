import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockVerifyToken, mockVerifyExtension, mockEffectiveScopes, mockQueryOne, mockResolveApiToken, mockIsLive } = vi.hoisted(() => {
  process.env.ADMIN_GATEWAY_SECRET = 'test-secret-for-gateway'
  return {
    mockVerifyToken: vi.fn(),
    mockVerifyExtension: vi.fn(),
    mockEffectiveScopes: vi.fn(),
    mockQueryOne: vi.fn(),
    mockResolveApiToken: vi.fn(),
    mockIsLive: vi.fn(),
  }
})

vi.mock('@/lib/auth/jwt', () => ({ verifyToken: mockVerifyToken, verifyExtensionToken: mockVerifyExtension }))
vi.mock('@/lib/auth/auth-sessions', () => ({ effectiveScopes: mockEffectiveScopes }))
vi.mock('@/lib/shared/db', () => ({ queryOne: mockQueryOne }))
vi.mock('@/lib/auth/api-tokens', async importOriginal => ({ ...(await importOriginal<object>()), resolveApiToken: mockResolveApiToken, isApiTokenLive: mockIsLive }))

import { GATEWAY_HEADER, signGatewayToken } from '@jeffi/service-auth'

import {
  resolveAdminPrincipal,
  principalDenied,
  principalGate,
  toAdminPayload,
  normaliseCertSerial,
  ensureServiceAccountAdmin,
} from '@/lib/auth/admin-principal'

function req(opts: { bearer?: string; cookie?: string; serial?: string; host?: string; gateway?: string; path?: string } = {}) {
  const headers = new Map<string, string>()
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`)
  if (opts.serial) headers.set('x-client-cert-serial', opts.serial)
  if (opts.gateway) headers.set(GATEWAY_HEADER, opts.gateway)
  headers.set('host', opts.host ?? 'admin.jeffistores.in')
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    cookies: { get: (n: string) => (opts.cookie && n === 'admin_sid' ? { value: opts.cookie } : undefined) },
    nextUrl: { pathname: opts.path ?? '/api/admin/orders' },
  } as any
}

const FLAGSHIP = '00000000-0000-0000-0000-000000000000'
const JFC = 'jfc_' + 'a'.repeat(43)
const JSA = 'jsa_' + 'b'.repeat(43)
const PERSON = { id: 'adm-9', role: 'admin', scopes: ['orders:read', 'orders:write', 'products:read'], is_active: true, email: 'p@x.in', first_name: 'P', last_name: 'Q' }

const SESSION = { adminId: 'adm-1', role: 'admin', scopes: ['products:read'], sid: 'sid-1', sessionId: 's1', authCertCN: 'alice@x.in', tenantId: null }
const SA_ROW = { id: 'sa-1', name: 'feed-bot', allowed_scopes: ['products:read'], admin_id: 'shadow-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mockVerifyToken.mockResolvedValue(null)
  mockVerifyExtension.mockResolvedValue(null)
  mockEffectiveScopes.mockImplementation(async (_t: string | null, granted: string[]) => granted)
  mockQueryOne.mockResolvedValue(null)
  mockIsLive.mockResolvedValue(true)
})

describe('resolveAdminPrincipal precedence', () => {
  it('a bearer session wins over the cookie and the cert', async () => {
    mockVerifyToken.mockResolvedValueOnce(SESSION)
    const p = await resolveAdminPrincipal(req({ bearer: 'tok', cookie: 'c', serial: '0A1B' }))
    expect(p).toMatchObject({ kind: 'session', credential: 'bearer', adminId: 'adm-1' })
    expect(mockVerifyToken).toHaveBeenCalledTimes(1)
    expect(mockVerifyToken.mock.calls[0][0]).toBe('tok')
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it('a bearer that is not a session is tried as an extension token', async () => {
    mockVerifyExtension.mockResolvedValueOnce({ adminId: 'ext-1', role: 'admin', scopes: ['orders:read'] })
    const p = await resolveAdminPrincipal(req({ bearer: 'eyJ', cookie: 'c' }))
    expect(p).toMatchObject({ kind: 'extension', credential: 'bearer', adminId: 'ext-1' })
    expect(mockVerifyToken).toHaveBeenCalledTimes(1)
  })

  it('a bearer that does not resolve falls through to the cookie, then the cert', async () => {
    mockVerifyToken.mockImplementation(async (t: string) => (t === 'c' ? SESSION : null))
    expect(await resolveAdminPrincipal(req({ bearer: 'junk', cookie: 'c', serial: 'AB' }))).toMatchObject({ kind: 'session', credential: 'cookie' })
    mockResolveApiToken.mockResolvedValueOnce(null)
    expect(await resolveAdminPrincipal(req({ bearer: JFC, cookie: 'c' }))).toMatchObject({ kind: 'session', credential: 'cookie' })
    mockQueryOne.mockResolvedValueOnce(SA_ROW)
    expect(await resolveAdminPrincipal(req({ bearer: 'junk', serial: 'AB' }), { lookupOnly: true })).toMatchObject({ kind: 'service_account', credential: 'cert' })
  })

  it('resolves a cookie session with its cert CN', async () => {
    mockVerifyToken.mockResolvedValueOnce(SESSION)
    const p = await resolveAdminPrincipal(req({ cookie: 'c' }), { touch: false })
    expect(p).toMatchObject({ kind: 'session', credential: 'cookie', authCertCN: 'alice@x.in' })
    expect(mockVerifyToken.mock.calls[0][2]).toEqual({ touch: false })
  })

  it('an invalid cookie falls through to a service account cert, and nothing else resolves to null', async () => {
    expect(await resolveAdminPrincipal(req({ cookie: 'stale', serial: 'AB' }))).toBeNull()
    mockQueryOne.mockResolvedValueOnce(SA_ROW)
    expect(await resolveAdminPrincipal(req({ cookie: 'stale', serial: 'AB' }), { lookupOnly: true })).toMatchObject({ kind: 'service_account' })
  })

  it('no credential at all is null', async () => {
    expect(await resolveAdminPrincipal(req())).toBeNull()
  })
})

describe('service account principal', () => {
  it('maps the normalised cert serial to the account, scopes through effectiveScopes', async () => {
    mockQueryOne.mockResolvedValueOnce(SA_ROW)
    mockEffectiveScopes.mockResolvedValueOnce(['products:read'])
    const p = await resolveAdminPrincipal(req({ serial: '00AB12' }), { tenantId: 't-1' })
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['ab12'])
    expect(mockEffectiveScopes).toHaveBeenCalledWith('t-1', ['products:read'], 'service_account')
    expect(p).toMatchObject({
      kind: 'service_account',
      credential: 'cert',
      adminId: 'shadow-1',
      role: 'service_account',
      scopes: ['products:read'],
      serviceAccountId: 'sa-1',
      tenantId: 't-1',
    })
  })

  it('creates the shadow admin on first use', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...SA_ROW, admin_id: null }).mockResolvedValueOnce({ admin_id: 'shadow-new' })
    const p = await resolveAdminPrincipal(req({ serial: 'AB' }))
    expect(p?.adminId).toBe('shadow-new')
    expect(String(mockQueryOne.mock.calls[1][0])).toMatch(/INSERT INTO admins/)
    expect(mockQueryOne.mock.calls[1][1]).toEqual(['svc-feed-bot@service-accounts.invalid', 'svc-feed-bot', '["products:read"]', 'sa-1'])
  })

  it('lookupOnly (middleware) neither creates the shadow admin nor records use', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...SA_ROW, admin_id: null })
    const p = await resolveAdminPrincipal(req({ serial: 'AB' }), { lookupOnly: true })
    expect(p).toMatchObject({ kind: 'service_account', adminId: '' })
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the shadow admin cannot be created', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...SA_ROW, admin_id: null }).mockRejectedValueOnce(new Error('no column'))
    expect(await resolveAdminPrincipal(req({ serial: 'AB' }))).toBeNull()
  })

  it('an unknown or revoked serial is null', async () => {
    expect(await resolveAdminPrincipal(req({ serial: 'AB' }))).toBeNull()
  })

  it('rejects a serial that is not hex', () => {
    expect(normaliseCertSerial('zz-12')).toBeNull()
    expect(normaliseCertSerial(' 000F ')).toBe('f')
  })

  it('ensureServiceAccountAdmin returns the linked admin id', async () => {
    mockQueryOne.mockResolvedValueOnce({ admin_id: 'shadow-9' })
    expect(await ensureServiceAccountAdmin({ id: 'sa-9', name: 'x', allowed_scopes: null })).toBe('shadow-9')
  })
})

describe('jfc_/jsa_ tokens', () => {
  const tok = (o: object) => ({ id: 'tok-1', tenantId: FLAGSHIP, kind: 'cli', adminId: 'adm-9', serviceAccountId: null, adminRole: 'admin', scopes: ['*'], host: 'admin.jeffistores.in', expiresAt: null, ...o })

  it("a person's token acts with the holder's current grant", async () => {
    mockResolveApiToken.mockResolvedValueOnce(tok({}))
    mockQueryOne.mockResolvedValueOnce(PERSON)
    const p = await resolveAdminPrincipal(req({ bearer: JFC }), { tenantId: null })
    expect(p).toMatchObject({ kind: 'cli', credential: 'bearer', tokenId: 'tok-1', adminId: 'adm-9', role: 'admin', scopes: PERSON.scopes })
    expect(mockVerifyToken).not.toHaveBeenCalled()
  })

  it('narrows to the token scopes, and never past the grant', async () => {
    mockResolveApiToken.mockResolvedValueOnce(tok({ scopes: ['orders:read', 'settings:write'] }))
    mockQueryOne.mockResolvedValueOnce(PERSON)
    const p = await resolveAdminPrincipal(req({ bearer: JFC }), { tenantId: null })
    expect(p?.scopes).toEqual(['orders:read'])
  })

  it("a narrowed owner's token drops the scope-bypassing role", async () => {
    mockResolveApiToken.mockResolvedValueOnce(tok({ scopes: ['orders:read'] }))
    mockQueryOne.mockResolvedValueOnce({ ...PERSON, role: 'administrator' })
    const p = await resolveAdminPrincipal(req({ bearer: JFC }), { tenantId: null })
    expect(p).toMatchObject({ role: 'admin', scopes: ['orders:read'] })
  })

  it('a deactivated holder or another store is refused', async () => {
    mockResolveApiToken.mockResolvedValueOnce(tok({}))
    mockQueryOne.mockResolvedValueOnce({ ...PERSON, is_active: false })
    expect(await resolveAdminPrincipal(req({ bearer: JFC }), { tenantId: null })).toBeNull()
    mockResolveApiToken.mockResolvedValueOnce(tok({ tenantId: 'other-store' }))
    expect(await resolveAdminPrincipal(req({ bearer: JFC }), { tenantId: null })).toBeNull()
  })

  it("a service-account key acts with the account's allowed scopes", async () => {
    mockResolveApiToken.mockResolvedValueOnce(tok({ kind: 'service_account', adminId: null, serviceAccountId: 'sa-1' }))
    mockQueryOne.mockResolvedValueOnce(SA_ROW)
    const p = await resolveAdminPrincipal(req({ bearer: JSA }), { tenantId: null, lookupOnly: true })
    expect(p).toMatchObject({ kind: 'service_account', via: 'service_account', serviceAccountId: 'sa-1', role: 'service_account', scopes: ['products:read'] })
  })
})

describe('gateway principal', () => {
  const claims = { tenantId: FLAGSHIP, kind: 'cli' as const, adminId: 'adm-9', scopes: ['*'], tokenId: 'tok-1', host: 'admin.jeffistores.in' }

  it("resolves the gateway's signed claims for this store and host", async () => {
    mockQueryOne.mockResolvedValueOnce(PERSON)
    const p = await resolveAdminPrincipal(req({ gateway: signGatewayToken(claims) }), { tenantId: null })
    expect(p).toMatchObject({ kind: 'gateway', credential: 'gateway', via: 'cli', tokenId: 'tok-1', adminId: 'adm-9' })
  })

  it('re-checks the token is still live, and refuses a revoked one', async () => {
    mockIsLive.mockResolvedValueOnce(false)
    expect(await resolveAdminPrincipal(req({ gateway: signGatewayToken(claims) }), { tenantId: null })).toBeNull()
    expect(mockIsLive).toHaveBeenCalledWith('tok-1', null)
    expect(mockQueryOne).not.toHaveBeenCalled()
    mockIsLive.mockRejectedValueOnce(new Error('db down'))
    expect(await resolveAdminPrincipal(req({ gateway: signGatewayToken(claims), cookie: 'c' }), { tenantId: null })).toBeNull()
  })

  it('refuses a forged, foreign-store, other-host or wrong-API header', async () => {
    mockQueryOne.mockClear() // isolate from any DB call another file in the shard left on the shared mock
    const forged = signGatewayToken(claims).replace(/.$/, c => (c === 'A' ? 'B' : 'A'))
    expect(await resolveAdminPrincipal(req({ gateway: forged }), { tenantId: null })).toBeNull()
    expect(await resolveAdminPrincipal(req({ gateway: signGatewayToken({ ...claims, tenantId: 'other' }) }), { tenantId: null })).toBeNull()
    expect(await resolveAdminPrincipal(req({ gateway: signGatewayToken(claims), host: 'admin-acme.jeffistores.in' }), { tenantId: null })).toBeNull()
    expect(await resolveAdminPrincipal(req({ gateway: signGatewayToken(claims), path: '/api/admin/ecom/customers' }), { tenantId: null })).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it("is held to its token kind's deny list", () => {
    expect(principalDenied({ kind: 'gateway', via: 'service_account' }, '/api/admin/users', 'GET')).not.toBeNull()
    expect(principalDenied({ kind: 'gateway', via: 'service_account' }, '/api/admin/cli/whoami', 'GET')).toBeNull()
    expect(principalDenied({ kind: 'gateway', via: 'service_account' }, '/api/admin/cli/logout', 'POST')).not.toBeNull()
    expect(principalDenied({ kind: 'gateway', via: 'cli' }, '/api/admin/cli/logout', 'POST')).toBeNull()
    expect(principalDenied({ kind: 'gateway', via: 'cli' }, '/api/admin/cli/tokens', 'GET')).not.toBeNull()
    expect(principalDenied({ kind: 'gateway', via: 'cli' }, '/api/admin/sessions/revoke-all', 'POST')).not.toBeNull()
  })
})

describe('principalDenied', () => {
  const sa = { kind: 'service_account' as const }
  const ext = { kind: 'extension' as const }

  it('keeps service accounts off people, credentials and sessions', () => {
    for (const p of ['/api/admin/users', '/api/admin/users/x', '/api/admin/token/generate', '/api/admin/mfa/verify', '/api/admin/sessions', '/api/admin/certificates/download', '/api/admin/account/mobile']) {
      expect(principalDenied(sa, p, 'GET')).not.toBeNull()
    }
    expect(principalDenied(sa, '/api/admin/service-accounts', 'POST')).not.toBeNull()
    expect(principalDenied(sa, '/api/admin/service-accounts/1/download', 'GET')).not.toBeNull()
    expect(principalDenied(sa, '/api/admin/service-accounts', 'GET')).toBeNull()
    expect(principalDenied(sa, '/api/admin/products', 'POST')).toBeNull()
  })

  it('keeps tokens off minting and people writes', () => {
    expect(principalDenied(ext, '/api/admin/token/generate', 'POST')).not.toBeNull()
    expect(principalDenied(ext, '/api/admin/cli/approve', 'POST')).not.toBeNull()
    expect(principalDenied(ext, '/api/admin/cli/tokens', 'POST')).not.toBeNull()
    expect(principalDenied(ext, '/api/admin/users/x', 'PATCH')).not.toBeNull()
    expect(principalDenied(ext, '/api/admin/service-accounts', 'POST')).not.toBeNull()
    expect(principalDenied(ext, '/api/admin/users', 'GET')).toBeNull()
    expect(principalDenied(ext, '/api/admin/orders', 'GET')).toBeNull()
  })

  it('never denies a session', () => {
    expect(principalDenied({ kind: 'session' }, '/api/admin/token/generate', 'POST')).toBeNull()
  })
})

describe('principalGate', () => {
  const sa = { kind: 'service_account' as const, role: 'service_account', scopes: ['products:read'] }

  it('passes a route inside the scope and refuses one outside it', () => {
    expect(principalGate(sa, '/api/admin/products', 'GET')).toBeNull()
    expect(principalGate(sa, '/api/admin/orders', 'GET')).toMatchObject({ status: 403, reason: 'scope:orders:read' })
  })

  it('keeps everyone but the administrator off the ecom API', () => {
    expect(principalGate(sa, '/api/admin/ecom/kyc/1/approve', 'POST', { scope: false })).toMatchObject({ status: 403, reason: 'platform_admin' })
    expect(principalGate({ kind: 'session', role: 'administrator', scopes: [] }, '/api/admin/ecom/kyc/1/approve', 'POST')).toBeNull()
  })

  it('checks the deny list before the scope', () => {
    expect(principalGate({ ...sa, scopes: ['settings:write'] }, '/api/admin/users', 'GET')?.reason).toBe('service_account:/api/admin/users')
  })
})

describe('toAdminPayload', () => {
  it('returns only the fields authenticateAdmin always returned', () => {
    const p = { ...SESSION, kind: 'session' as const, credential: 'cookie' as const, email: 'a@x.in', displayName: 'Alice' }
    expect(toAdminPayload(p)).toEqual({ adminId: 'adm-1', email: 'a@x.in', role: 'admin', scopes: ['products:read'], sid: 'sid-1', sessionId: 's1', deadlineAt: undefined, expiresAt: undefined })
  })
})
