import { describe, it, expect, vi, beforeEach } from 'vitest'

// resolveSession/createSession hit Postgres via ./db — mock it so the binding-integration
// tests below can drive rows/spies. The pure helpers need no mock; the mock is inert for them.
const mockQueryOne = vi.fn()
const mockQuery = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  query: (...args: any[]) => mockQuery(...args),
  queryMany: vi.fn(),
}))

import {
  uaFingerprint,
  uaClearlyDiffers,
  langPrimary,
  normPlatform,
  ipNetwork,
  evaluateBinding,
  resolveSession,
  createSession,
  hashToken,
  validateSession,
  extendSession,
  revokeSession,
  revokeAllForPrincipal,
  listActiveSessions,
  type StoredBinding,
} from '@/lib/auth/auth-sessions'

// Device-binding fingerprint: browser family + OS family, versions DROPPED so routine
// auto-updates never force a re-login, but a genuinely different browser/device does.

const CHROME_MAC_139 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const CHROME_MAC_140 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const FF_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'

describe('uaFingerprint', () => {
  it('classifies common browser/OS families', () => {
    expect(uaFingerprint(CHROME_MAC_139)).toBe('chrome|macos')
    expect(uaFingerprint(SAFARI_IOS)).toBe('safari|ios')
    expect(uaFingerprint(SAFARI_MAC)).toBe('safari|macos')
    expect(uaFingerprint(FF_WIN)).toBe('firefox|windows')
    expect(uaFingerprint(EDGE_WIN)).toBe('edge|windows')
    expect(uaFingerprint(CHROME_ANDROID)).toBe('chrome|android')
  })

  it('drops version numbers (139 and 140 fingerprint identically)', () => {
    expect(uaFingerprint(CHROME_MAC_139)).toBe(uaFingerprint(CHROME_MAC_140))
  })

  it('returns null for absent or unclassifiable UAs', () => {
    expect(uaFingerprint(null)).toBeNull()
    expect(uaFingerprint(undefined)).toBeNull()
    expect(uaFingerprint('')).toBeNull()
    expect(uaFingerprint('curl/8.0')).toBeNull()
    expect(uaFingerprint('PostmanRuntime/7.0')).toBeNull()
  })
})

describe('uaClearlyDiffers', () => {
  it('does NOT flag a version-only change (auto-update)', () => {
    expect(uaClearlyDiffers(CHROME_MAC_139, CHROME_MAC_140)).toBe(false)
  })

  it('flags a different browser on the same OS (e.g. Chrome vs Edge on Windows)', () => {
    expect(uaClearlyDiffers(CHROME_WIN, EDGE_WIN)).toBe(true)
  })

  it('flags a different OS / device family', () => {
    expect(uaClearlyDiffers(CHROME_MAC_139, SAFARI_IOS)).toBe(true)
    expect(uaClearlyDiffers(CHROME_MAC_139, CHROME_ANDROID)).toBe(true)
    expect(uaClearlyDiffers(CHROME_MAC_139, FF_WIN)).toBe(true)
  })

  it('fails OPEN when either UA is null/unknown (never a false re-auth)', () => {
    expect(uaClearlyDiffers(null, CHROME_MAC_139)).toBe(false)
    expect(uaClearlyDiffers(CHROME_MAC_139, null)).toBe(false)
    expect(uaClearlyDiffers('curl/8.0', 'PostmanRuntime/7.0')).toBe(false)
    expect(uaClearlyDiffers('curl/8.0', CHROME_MAC_139)).toBe(false)
  })
})

describe('langPrimary', () => {
  it('extracts the primary subtag and drops region/q-values', () => {
    expect(langPrimary('en-US,en;q=0.9')).toBe('en')
    expect(langPrimary('fr-CA')).toBe('fr')
    expect(langPrimary('FR')).toBe('fr')
  })
  it('returns null for empty/null', () => {
    expect(langPrimary('')).toBeNull()
    expect(langPrimary(null)).toBeNull()
    expect(langPrimary(undefined)).toBeNull()
  })
  it('treats en-US and en-GB as the same primary (no diff)', () => {
    expect(langPrimary('en-US')).toBe(langPrimary('en-GB'))
  })
})

describe('normPlatform', () => {
  it('strips surrounding quotes and lowercases', () => {
    expect(normPlatform('"macOS"')).toBe('macos')
    expect(normPlatform('Windows')).toBe('windows')
    expect(normPlatform('"Android"')).toBe('android')
  })
  it('returns null for empty/null', () => {
    expect(normPlatform('')).toBeNull()
    expect(normPlatform(null)).toBeNull()
    expect(normPlatform('""')).toBeNull()
  })
})

describe('ipNetwork', () => {
  it('reduces IPv4 to a /16 network', () => {
    expect(ipNetwork('203.0.113.5')).toBe('203.0')
    expect(ipNetwork('10.20.30.40')).toBe('10.20')
  })
  it('takes the FIRST hop of an X-Forwarded-For list', () => {
    expect(ipNetwork('203.0.113.5, 70.1.2.3, 10.0.0.1')).toBe('203.0')
  })
  it('reduces IPv6 to a coarse hextet prefix', () => {
    expect(ipNetwork('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3')
  })
  it('returns null for unparseable/null and NEVER returns a full IP', () => {
    expect(ipNetwork('garbage')).toBeNull()
    expect(ipNetwork('999.1.1.1')).toBeNull()
    expect(ipNetwork(null)).toBeNull()
    expect(ipNetwork('')).toBeNull()
    expect(ipNetwork('203.0.113.5')).not.toContain('113')
  })
})

// Fully-populated stored snapshot we selectively diverge from.
const STORED: StoredBinding = {
  userAgent: CHROME_MAC_139,
  acceptLang: 'en',
  uaPlatform: 'macos',
  ipNet: '203.0',
  fpHash: 'abc123',
}

describe('evaluateBinding — conservative scoring', () => {
  it('no diff at all → no revoke', () => {
    const d = evaluateBinding(STORED, {
      userAgent: CHROME_MAC_140, // same family, version bump
      acceptLanguage: 'en-US,en;q=0.9',
      uaPlatform: '"macOS"',
      ip: '203.0.113.9',
      fpHash: 'abc123',
    })
    expect(d.revoke).toBe(false)
    expect(d.stableDiffs).toBe(0)
    expect(d.softDiffs).toBe(0)
  })

  it('SOFT signals alone never revoke (ip + fp differ, stable all match)', () => {
    const d = evaluateBinding(STORED, {
      userAgent: CHROME_MAC_139,
      acceptLanguage: 'en',
      uaPlatform: 'macos',
      ip: '8.8.8.8',
      fpHash: 'totally-different',
    })
    expect(d.softDiffs).toBe(2)
    expect(d.stableDiffs).toBe(0)
    expect(d.revoke).toBe(false)
  })

  it('exactly ONE stable diff → no revoke (single fuzzy signal rule)', () => {
    const d = evaluateBinding(STORED, {
      userAgent: CHROME_MAC_139,
      acceptLanguage: 'de',
      uaPlatform: 'macos',
      ip: '203.0.113.9',
      fpHash: 'abc123',
    })
    expect(d.stableDiffs).toBe(1)
    expect(d.revoke).toBe(false)
  })

  it('one stable diff + both soft diffs → still no revoke (soft never lowers the threshold)', () => {
    const d = evaluateBinding(STORED, {
      userAgent: CHROME_MAC_139,
      acceptLanguage: 'de',
      uaPlatform: 'macos',
      ip: '8.8.8.8',
      fpHash: 'nope',
    })
    expect(d.stableDiffs).toBe(1)
    expect(d.softDiffs).toBe(2)
    expect(d.revoke).toBe(false)
  })

  it('TWO stable diffs → revoke', () => {
    const d = evaluateBinding(STORED, {
      userAgent: SAFARI_IOS, // family differs (safari|ios)
      acceptLanguage: 'de', // language differs
      uaPlatform: 'macos',
      ip: '203.0.113.9',
      fpHash: 'abc123',
    })
    expect(d.stableDiffs).toBe(2)
    expect(d.revoke).toBe(true)
  })

  it('THREE stable diffs → revoke', () => {
    const d = evaluateBinding(STORED, {
      userAgent: SAFARI_IOS,
      acceptLanguage: 'de',
      uaPlatform: '"Windows"',
      ip: '203.0.113.9',
      fpHash: 'abc123',
    })
    expect(d.stableDiffs).toBe(3)
    expect(d.revoke).toBe(true)
  })

  it('NULL on either side is excluded from scoring (fail open)', () => {
    const d = evaluateBinding(STORED, {})
    expect(d.stableDiffs).toBe(0)
    expect(d.softDiffs).toBe(0)
    expect(d.revoke).toBe(false)
  })

  it('old row with all-NULL snapshot never revokes even against wildly different current', () => {
    const emptyStored: StoredBinding = {
      userAgent: null,
      acceptLang: null,
      uaPlatform: null,
      ipNet: null,
      fpHash: null,
    }
    const d = evaluateBinding(emptyStored, {
      userAgent: SAFARI_IOS,
      acceptLanguage: 'de',
      uaPlatform: '"Windows"',
      ip: '8.8.8.8',
      fpHash: 'x',
    })
    expect(d.revoke).toBe(false)
  })
})

describe('resolveSession — binding integration', () => {
  const SID = '11111111-1111-4111-8111-111111111111'
  const liveRow = () => ({
    id: SID,
    principal_type: 'customer',
    principal_id: '22222222-2222-4222-8222-222222222222',
    revoked_at: null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    role: null,
    scopes: [],
    cert_cn: null,
    approval_status: null,
    user_agent: CHROME_MAC_139,
    accept_lang: 'en',
    ua_platform: 'macos',
    ip_net: '203.0',
    fp_hash: 'abc123',
    email: 'u@example.com',
    first_name: 'U',
    last_name: 'Ser',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('legacy bare-UA string still works (matching family → resolves)', async () => {
    mockQueryOne.mockResolvedValue(liveRow())
    const s = await resolveSession(SID, CHROME_MAC_139)
    expect(s).not.toBeNull()
    expect(s?.principalType).toBe('customer')
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('revoked_at = now()'), [SID])
  })

  it('two stable diffs → revokes (issues UPDATE) and returns null', async () => {
    mockQueryOne.mockResolvedValue(liveRow())
    const s = await resolveSession(SID, { userAgent: SAFARI_IOS, acceptLanguage: 'de' })
    expect(s).toBeNull()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('revoked_at = now()'), [SID])
  })

  it('one stable + two soft diffs → returns the session, no revoke UPDATE', async () => {
    mockQueryOne.mockResolvedValue(liveRow())
    const s = await resolveSession(SID, {
      userAgent: CHROME_MAC_139, // same family
      acceptLanguage: 'de', // 1 stable diff
      uaPlatform: 'macos',
      ip: '8.8.8.8', // soft diff
      fpHash: 'different', // soft diff
    })
    expect(s).not.toBeNull()
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('revoked_at = now()'), [SID])
  })

  it('all-NULL stored snapshot (pre-deploy row) → no revoke even with different signals', async () => {
    const row = liveRow()
    row.user_agent = null as any
    row.accept_lang = null as any
    row.ua_platform = null as any
    row.ip_net = null as any
    row.fp_hash = null as any
    mockQueryOne.mockResolvedValue(row)
    const s = await resolveSession(SID, {
      userAgent: SAFARI_IOS,
      acceptLanguage: 'de',
      uaPlatform: '"Windows"',
      ip: '8.8.8.8',
      fpHash: 'x',
    })
    expect(s).not.toBeNull()
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('revoked_at = now()'), [SID])
  })
})

describe('hashToken', () => {
  it('produces a stable 64-char lowercase hex digest', () => {
    const h = hashToken('sometoken')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('sometoken')).toBe(h) // stable
    expect(hashToken('other')).not.toBe(h)
  })
})

describe('createSession — opaque token', () => {
  const ROW_ID = '33333333-3333-4333-8333-333333333333'
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryOne.mockResolvedValue({ id: ROW_ID })
  })

  it('returns a 64-hex token as sid (not a uuid) and the row id separately', async () => {
    const { sid, id } = await createSession({ principalType: 'customer', principalId: 'u1', ttlSeconds: 3600 })
    expect(sid).toMatch(/^[0-9a-f]{64}$/)
    // The cookie value must NOT be a uuid anymore.
    expect(sid).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(id).toBe(ROW_ID)
  })

  it('stores SHA-256(token) in token_hash, never the raw token', async () => {
    const { sid } = await createSession({ principalType: 'customer', principalId: 'u1', ttlSeconds: 3600 })
    const params = mockQueryOne.mock.calls[0][1] as any[]
    // token_hash is the last INSERT param.
    const storedHash = params[params.length - 1]
    expect(storedHash).toBe(hashToken(sid))
    expect(params).not.toContain(sid) // raw token is never persisted
  })
})

describe('resolveSession — token vs legacy lookup routing', () => {
  const ROW_ID = '44444444-4444-4444-8444-444444444444'
  const TOKEN = 'a'.repeat(64) // valid TOKEN_RE shape
  const tokenRow = () => ({
    id: ROW_ID,
    principal_type: 'customer',
    principal_id: '55555555-5555-4555-8555-555555555555',
    revoked_at: null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    role: null,
    scopes: [],
    cert_cn: null,
    approval_status: null,
    user_agent: null,
    accept_lang: null,
    ua_platform: null,
    ip_net: null,
    fp_hash: null,
    email: 'u@example.com',
    first_name: 'U',
    last_name: 'Ser',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('a token cookie is looked up by token_hash = SHA-256(token), not the raw token', async () => {
    mockQueryOne.mockResolvedValue(tokenRow())
    const s = await resolveSession(TOKEN)
    expect(s).not.toBeNull()
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('token_hash = $1')
    expect(params[0]).toBe(hashToken(TOKEN))
    expect(params[0]).not.toBe(TOKEN) // never look up by the raw token
  })

  it('a legacy uuid cookie is looked up by id (transition path)', async () => {
    mockQueryOne.mockResolvedValue(tokenRow())
    const legacyUuid = '66666666-6666-4666-8666-666666666666'
    const s = await resolveSession(legacyUuid)
    expect(s).not.toBeNull()
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('id = $1')
    expect(params[0]).toBe(legacyUuid)
  })

  it('a value that is neither a token nor a uuid → null, no DB hit', async () => {
    const s = await resolveSession('not-a-valid-anything')
    expect(s).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
})

const liveBase = () => ({
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  principal_type: 'customer' as const,
  principal_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  revoked_at: null,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  last_seen_at: new Date().toISOString(),
  role: null,
  scopes: [],
  cert_cn: null,
  approval_status: null,
  user_agent: null,
  accept_lang: null,
  ua_platform: null,
  ip_net: null,
  fp_hash: null,
  email: 'x@y.com',
  first_name: 'X',
  last_name: 'Y',
})

describe('resolveSession — extra edge paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('returns null for a revoked row', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), revoked_at: new Date().toISOString() })
    expect(await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBeNull()
  })

  it('returns null for an expired row (past expires_at)', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), expires_at: new Date(Date.now() - 1000).toISOString() })
    expect(await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBeNull()
  })

  it('returns null for idle-expired row (last_seen past the 30d storefront cap)', async () => {
    mockQueryOne.mockResolvedValue({
      ...liveBase(),
      last_seen_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBeNull()
  })

  it('fires last_seen_at touch UPDATE when beyond touch window', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    const s = await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(s).not.toBeNull()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_seen_at = now()'), [
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ])
  })

  it('returns resolved session with displayName from first+last name', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), first_name: 'John', last_name: 'Doe' })
    const s = await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(s?.displayName).toBe('John Doe')
  })

  it('returns null displayName when no name fields', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), first_name: null, last_name: null })
    const s = await resolveSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(s?.displayName).toBeNull()
  })
})

describe('validateSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('returns true when session resolves and principalType matches', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), principal_type: 'customer' })
    expect(await validateSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'customer')).toBe(true)
  })

  it('returns false when principalType mismatches', async () => {
    mockQueryOne.mockResolvedValue({ ...liveBase(), principal_type: 'customer' })
    expect(await validateSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'admin')).toBe(false)
  })

  it('returns false when session does not exist', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await validateSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'customer')).toBe(false)
  })
})

describe('extendSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('updates expiry using token_hash for a 64-hex token', async () => {
    const token = 'e'.repeat(64)
    await extendSession(token, 3600)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('token_hash = $1'),
      expect.arrayContaining([hashToken(token)])
    )
  })

  it('updates expiry using id for a legacy uuid', async () => {
    const uuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await extendSession(uuid, 3600)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('id = $1'), expect.arrayContaining([uuid]))
  })

  it('no-ops for empty sid', async () => {
    await extendSession('', 3600)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('no-ops for malformed sid (neither token nor uuid)', async () => {
    await extendSession('not-valid', 3600)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('revokeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rowCount: 1 })
  })

  it('revokes by token_hash for a 64-hex token', async () => {
    const token = 'f'.repeat(64)
    await revokeSession(token)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('token_hash = $1'), [hashToken(token)])
  })

  it('revokes by id for a legacy uuid', async () => {
    const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await revokeSession(uuid)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('id = $1'), [uuid])
  })

  it('no-ops for empty sid', async () => {
    await revokeSession('')
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('revokeAllForPrincipal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('issues bulk revoke and returns affected rowCount', async () => {
    mockQuery.mockResolvedValue({ rowCount: 3 })
    expect(await revokeAllForPrincipal('customer', 'u1')).toBe(3)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('principal_type = $1'), ['customer', 'u1'])
  })

  it('returns 0 when nothing revoked', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 })
    expect(await revokeAllForPrincipal('admin', 'a1')).toBe(0)
  })

  it('returns 0 when rowCount is null', async () => {
    mockQuery.mockResolvedValue({ rowCount: null })
    expect(await revokeAllForPrincipal('business', 'b1')).toBe(0)
  })
})

describe('listActiveSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns session rows from queryMany', async () => {
    const { queryMany } = await import('@/lib/shared/db')
    vi.mocked(queryMany).mockResolvedValue([{ id: 'r1' }, { id: 'r2' }] as any)
    const rows = await listActiveSessions('customer', 'u1')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'r1' })
  })

  it('returns empty array when no active sessions', async () => {
    const { queryMany } = await import('@/lib/shared/db')
    vi.mocked(queryMany).mockResolvedValue([])
    expect(await listActiveSessions('admin', 'a1')).toEqual([])
  })
})
