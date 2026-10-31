import { describe, it, expect, vi, beforeEach } from 'vitest'

const { conn, queryOne, refreshMirror } = vi.hoisted(() => ({
  conn: { query: vi.fn(), release: vi.fn() },
  queryOne: vi.fn(),
  refreshMirror: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ getClient: vi.fn(async () => conn), queryOne, queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/refresh', () => ({ refreshMirror }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn(), resolveGoogleAdsCreds: vi.fn(), googleAdsClientFromCreds: vi.fn() }))

import { GoogleAdsClient } from '@/lib/google-ads/client'
import { DataManagerClient } from '@/lib/google-ads/conversions/data-manager'
import { dmUserIdentifiers, sha256Hex } from '@/lib/google-ads/conversions/hash'
import { diffMembers, fingerprintOf, segmentParams, segmentQuery, toMembers, SEGMENTS } from '@/lib/google-ads/audiences/segments'
import { dataManagerUploader, refreshAudiences, type AudienceUploader } from '@/lib/google-ads/audiences/refresh'
import { ActionSchema, runAction } from '@/lib/google-ads/actions'
import { withAudienceRestriction } from '@/lib/google-ads/audiences/attach'

const CID = '1234567890'
const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ads = () =>
  new GoogleAdsClient({
    refreshToken: 'rt',
    customerId: CID,
    developerToken: 'dev',
    fetchImpl: fetchMock as any,
    retryDelays: [],
    getAccessToken: async () => ({ token: 'at', expiresInSec: 3600 }),
  })

describe('segment SQL', () => {
  it('binds parameters and always filters guests, opt-outs and inactive accounts', () => {
    for (const s of SEGMENTS) {
      const q = segmentQuery(s, segmentParams(s, {}))
      expect(q.sql).toContain('u.is_guest IS NOT TRUE')
      expect(q.sql).toContain("u.email NOT ILIKE '%@temporary.local'")
      expect(q.sql).toContain('u.marketing_opt_out IS NOT TRUE')
      expect(q.sql).toContain("o.payment_status = 'paid'")
      // Consent comes from the latest order (no account-level ad consent exists).
      expect(q.sql).toMatch(/DISTINCT ON \(o\.user_id\) o\.user_id, o\.ads_consent/)
      expect(q.sql).toContain('(l.ads_consent IS TRUE) AS consented')
      expect(q.sql).not.toMatch(/\$\d+\$/)
    }
  })

  it('uses each segment rule with its defaults and stored overrides', () => {
    expect(segmentQuery('repeat_buyers', segmentParams('repeat_buyers', {}))).toMatchObject({ values: [2] })
    expect(segmentQuery('lapsed', segmentParams('lapsed', { days: 365 }))).toMatchObject({ values: [365] })
    expect(segmentQuery('lapsed', segmentParams('lapsed', {})).sql).toContain('p.last_at < now() - make_interval(days => $1)')
    expect(segmentQuery('recent_buyers', segmentParams('recent_buyers', {})).sql).toContain('p.last_at >= now()')
    expect(segmentQuery('high_value', segmentParams('high_value', { topPercent: 20 }))).toMatchObject({ values: [0.2] })
    expect(segmentQuery('b2b', segmentParams('b2b', {})).sql).toContain("bp.approval_status = 'approved'")
    expect(segmentParams('lapsed', { days: 1 }).days).toBe(180)
  })
})

describe('members', () => {
  const rows = [
    { user_id: 'u1', email: 'Jo.Doe+shop@Gmail.com ', phone: '98765 43210', consented: true },
    { user_id: 'u2', email: 'no@consent.in', phone: null, consented: false },
    { user_id: 'u3', email: 'bad', phone: 'x', consented: true },
  ]
  it('uploads only consented customers with a usable identifier, hashed like conversions', () => {
    const m = toMembers(rows)
    expect(m.map(x => x.userId)).toEqual(['u1'])
    expect(m[0].identifiers).toEqual(dmUserIdentifiers(rows[0].email, rows[0].phone))
    expect(m[0].identifiers).toEqual([{ emailAddress: sha256Hex('jodoe@gmail.com') }, { phoneNumber: sha256Hex('+919876543210') }])
    expect(m[0].fingerprint).toBe(fingerprintOf([...m[0].identifiers].reverse()))
  })

  it('adds new and changed members, removes departed ones and stale identifiers', () => {
    const [a] = toMembers([{ user_id: 'a', email: 'a@x.in', phone: null, consented: true }])
    const [b] = toMembers([{ user_id: 'b', email: 'b2@x.in', phone: null, consented: true }])
    const old = toMembers([{ user_id: 'b', email: 'b@x.in', phone: null, consented: true }])[0]
    const d = diffMembers([a, b], [
      { user_id: 'b', identifiers: old.identifiers, fingerprint: old.fingerprint },
      { user_id: 'c', identifiers: [{ emailAddress: 'h' }], fingerprint: 'f' },
    ])
    expect(d.add.map(m => m.userId)).toEqual(['a', 'b'])
    expect(d.remove.map(m => m.userId).sort()).toEqual(['b', 'c'])
    expect(diffMembers([a], [{ user_id: 'a', identifiers: a.identifiers, fingerprint: a.fingerprint }])).toEqual({ add: [], remove: [] })
  })
})

describe('Data Manager upload', () => {
  it('ingests with consent, terms and HEX encoding, and removes without them', async () => {
    const dmFetch = vi.fn(async (_u: string, _i: any) => json({ requestId: 'req-1' }))
    const dm = new DataManagerClient({ fetchImpl: dmFetch as any, retryDelays: [], getAccessToken: async () => ({ token: 't', expiresInSec: 3600 }) })
    const up = dataManagerUploader(dm)
    const dest = { operatingAccount: { accountType: 'GOOGLE_ADS' as const, accountId: CID }, productDestinationId: '77' }
    expect(await up.ingest(dest, [[{ emailAddress: 'aa' }]])).toBe('req-1')
    await up.remove(dest, [[{ phoneNumber: 'bb' }]])
    const [ingest, remove] = dmFetch.mock.calls
    expect(ingest[0]).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest')
    expect(JSON.parse(ingest[1].body)).toEqual({
      destinations: [dest],
      audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: 'aa' }] } }],
      encoding: 'HEX',
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
      termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    })
    expect(remove[0]).toBe('https://datamanager.googleapis.com/v1/audienceMembers:remove')
    expect(JSON.parse(remove[1].body)).not.toHaveProperty('consent')
  })
})

describe('refreshAudiences', () => {
  let state: { audiences: any[]; members: any[]; segmentRows: any[] }
  const up: AudienceUploader & { calls: any[] } = {
    calls: [],
    ingest: vi.fn(async (d, m) => {
      up.calls.push(['ingest', d, m])
      return 'req-9'
    }),
    remove: vi.fn(async (d, m) => {
      up.calls.push(['remove', d, m])
      return 'req-r'
    }),
    status: vi.fn(async () => 'MATCH_RATE_RANGE_41_TO_50'),
  }

  beforeEach(() => {
    fetchMock.mockReset()
    up.calls = []
    queryOne.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM site_settings')) return { value: '2026-10-01T00:00:00Z' }
      if (sql.includes('INSERT INTO ads_change_log')) return { id: '1' }
      return null
    })
    state = {
      audiences: [{ segment: 'repeat_buyers', enabled: true, params: {}, customer_id: null, user_list: null, member_count: 0 }],
      members: [],
      segmentRows: [
        { user_id: '00000000-0000-4000-8000-000000000001', email: 'a@x.in', phone: null, consented: true },
        { user_id: '00000000-0000-4000-8000-000000000002', email: 'b@x.in', phone: null, consented: false },
      ],
    }
    conn.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
      if (sql.startsWith('SELECT * FROM ads_audiences')) return { rows: state.audiences }
      if (sql.includes('FROM ads_audience_members')) return { rows: state.members }
      if (sql.includes('WITH paid AS')) return { rows: state.segmentRows }
      return { rows: [], rowCount: 0 }
    })
  })

  it('creates the CRM list once (validated, logged) and uploads only consented members', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ mutateOperationResponses: [{ userListResult: { resourceName: `customers/${CID}/userLists/555` } }] }))
      .mockResolvedValue(json([{ results: [{ userList: { resourceName: `customers/${CID}/userLists/555`, sizeForSearch: '0', matchRatePercentage: 40 } }] }]))
    const r = await refreshAudiences({ client: ads(), uploader: up })
    expect(r.status).toBe('success')
    expect(r.segments[0]).toMatchObject({ segment: 'repeat_buyers', inSegment: 2, members: 1, added: 1, removed: 0 })
    const create = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(create.mutateOperations[0].userListOperation.create).toMatchObject({
      membershipStatus: 'OPEN',
      membershipLifeSpan: 540,
      crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).validateOnly).toBe(true)
    const [kind, dest, members] = up.calls[0]
    expect(kind).toBe('ingest')
    expect(dest).toEqual({ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: CID }, productDestinationId: '555' })
    expect(members).toEqual([[{ emailAddress: sha256Hex('a@x.in') }]])
    expect(conn.query.mock.calls.some(c => String(c[0]).includes('pg_advisory_unlock'))).toBe(true)
  })

  it('needs the Customer Match terms before uploading anything', async () => {
    queryOne.mockResolvedValue(null)
    const r = await refreshAudiences({ client: ads(), uploader: up })
    expect(r.status).toBe('needs_terms')
    expect(up.calls).toEqual([])
  })

  it('empties a list that was turned off', async () => {
    state.audiences = [{ segment: 'lapsed', enabled: false, params: {}, customer_id: CID, user_list: `customers/${CID}/userLists/9`, member_count: 1 }]
    state.members = [{ user_id: 'u', identifiers: [{ emailAddress: 'zz' }], fingerprint: 'f' }]
    fetchMock.mockResolvedValue(json([]))
    const r = await refreshAudiences({ client: ads(), uploader: up })
    expect(r.segments[0]).toMatchObject({ status: 'disabled', removed: 1 })
    expect(up.calls[0][0]).toBe('remove')
  })
})

describe('audience.attach', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    queryOne.mockReset().mockImplementation(async (sql: string, p?: any[]) => {
      if (sql.includes('FROM ads_audiences')) return { user_list: `customers/${CID}/userLists/555`, customer_id: CID }
      if (sql.includes('FROM ads_campaigns')) return p?.[0] === '9' ? { name: 'PMax', channel_type: 'PERFORMANCE_MAX' } : { name: 'Brand', channel_type: 'SEARCH' }
      if (sql.includes('INSERT INTO ads_change_log')) return { id: '1' }
      return null
    })
  })
  const actor = { adminId: null, email: 'o@s.in' }

  it('adds an asset-group audience signal on Performance Max', async () => {
    fetchMock.mockResolvedValue(json({}))
    await runAction(ActionSchema.parse({ action: 'audience.attach', segment: 'high_value', campaignId: '9', mode: 'signal', assetGroupId: '44' }), ads(), actor, true)
    const ops = JSON.parse(fetchMock.mock.calls[0][1].body).mutateOperations
    expect(ops[0].audienceOperation.create).toMatchObject({
      scope: 'ASSET_GROUP',
      assetGroup: `customers/${CID}/assetGroups/44`,
      dimensions: [{ audienceSegments: { segments: [{ userList: { userList: `customers/${CID}/userLists/555` } }] } }],
    })
    expect(ops[1].assetGroupSignalOperation.create).toEqual({ assetGroup: `customers/${CID}/assetGroups/44`, audience: { audience: ops[0].audienceOperation.create.resourceName } })
  })

  it('observes on Search with an explicit bid-only audience restriction, keeping others', async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ results: [{ campaign: { targetingSetting: { targetRestrictions: [{ targetingDimension: 'AGE_RANGE', bidOnly: true }, { targetingDimension: 'AUDIENCE', bidOnly: false }] } } }] }]))
      .mockResolvedValue(json({}))
    const r = await runAction(ActionSchema.parse({ action: 'audience.attach', segment: 'repeat_buyers', campaignId: '5', mode: 'observation' }), ads(), actor, true)
    const ops = JSON.parse(fetchMock.mock.calls[1][1].body).mutateOperations
    expect(ops[0].campaignCriterionOperation.create).toEqual({ campaign: `customers/${CID}/campaigns/5`, userList: { userList: `customers/${CID}/userLists/555` } })
    expect(ops[1].campaignOperation).toEqual({
      update: { resourceName: `customers/${CID}/campaigns/5`, targetingSetting: { targetRestrictions: [{ targetingDimension: 'AGE_RANGE', bidOnly: true }, { targetingDimension: 'AUDIENCE', bidOnly: true }] } },
      updateMask: 'targeting_setting.target_restrictions',
    })
    expect(r.summary).toBe('Added "Repeat buyers" to "Brand" as observation')
  })

  it('excludes with a negative campaign criterion and refuses a signal on Search', async () => {
    fetchMock.mockResolvedValue(json({}))
    await runAction(ActionSchema.parse({ action: 'audience.attach', segment: 'recent_buyers', campaignId: '5', mode: 'exclusion' }), ads(), actor, true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mutateOperations[0].campaignCriterionOperation.create.negative).toBe(true)
    await expect(runAction(ActionSchema.parse({ action: 'audience.attach', segment: 'recent_buyers', campaignId: '5', mode: 'signal' }), ads(), actor, true)).rejects.toThrow(/Performance Max/)
  })

  it('sets targeting as not bid-only', () => {
    expect(withAudienceRestriction([], false)).toEqual([{ targetingDimension: 'AUDIENCE', bidOnly: false }])
  })
})
