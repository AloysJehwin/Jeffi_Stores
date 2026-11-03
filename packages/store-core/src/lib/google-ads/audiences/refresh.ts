import type { PoolClient } from 'pg'
import { getClient, query, queryMany, queryOne } from '@/lib/shared/db'
import { normalizeCustomerId, type GoogleAdsClient } from '../client'
import { googleAdsClientFromCreds, resolveGoogleAdsCreds } from '../credentials'
import { DataManagerApiError, adsDestination, dataManagerClientFor, type DataManagerClient } from '../conversions/data-manager'
import type { DataManagerIdentifier } from '../conversions/hash'
import { AdsMutationError, idFrom, runMutation, type ChangeActor } from '../mutate'
import {
  SEGMENTS,
  SEGMENT_DEFS,
  diffMembers,
  segmentParams,
  segmentQuery,
  toMembers,
  type Segment,
  type SegmentRow,
} from './segments'

// Customer Match lists: created with the Google Ads API (UserListService, CRM_BASED, contact info,
// first party) and filled through the Data Manager API (audienceMembers:ingest / remove), which
// Google requires for Customer Match from projects without uploads before April 2026. Each refresh
// sends only the difference against what the list holds (ads_audience_members).

export const ADS_AUDIENCES_LOCK_KEY = 84219597
export const MEMBERS_PER_REQUEST = 5000
/** Google's current minimum of active matched members for a list to serve (formerly 1,000 on Search). */
export const MIN_ACTIVE_MEMBERS = 100
export const MEMBERSHIP_DAYS = 540
export const TERMS_KEY = 'google_ads_customer_match_terms_at'

export class AudienceRefreshInProgressError extends Error {
  constructor() {
    super('Audience lists are already refreshing. Try again when it finishes.')
    this.name = 'AudienceRefreshInProgressError'
  }
}

type Db = Pick<PoolClient, 'query'>

export interface AudienceRow {
  segment: Segment
  enabled: boolean
  params: Record<string, unknown>
  customer_id: string | null
  user_list: string | null
  name: string | null
  segment_count: number
  member_count: number
  added_count: number
  removed_count: number
  size_for_search: string | null
  size_for_display: string | null
  match_rate: number | null
  match_rate_range: string | null
  eligible_for_search: boolean | null
  eligible_for_display: boolean | null
  membership_status: string | null
  google_checked_at: string | null
  last_request_id: string | null
  last_refresh_at: string | null
  last_refresh_status: string | null
  last_error: string | null
}

export interface SegmentResult {
  segment: Segment
  status: 'success' | 'error' | 'disabled' | 'skipped'
  inSegment: number
  members: number
  added: number
  removed: number
  error?: string
}

export interface AudienceRunResult {
  status: 'success' | 'partial' | 'error' | 'needs_terms' | 'nothing_enabled'
  segments: SegmentResult[]
  error?: string
}

export async function customerMatchTermsAcceptedAt(): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [TERMS_KEY]).catch(() => null)
  return row?.value || null
}

export async function acceptCustomerMatchTerms(): Promise<void> {
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TERMS_KEY, new Date().toISOString()]
  )
}

export async function loadAudienceRows(db: Db = { query } as unknown as Db): Promise<AudienceRow[]> {
  const res = await db.query(`SELECT * FROM ads_audiences`)
  const rows = ((res as any).rows ?? res) as AudienceRow[]
  return SEGMENTS.map(s => rows.find(r => r.segment === s) ?? emptyRow(s))
}

function emptyRow(segment: Segment): AudienceRow {
  return {
    segment,
    enabled: false,
    params: {},
    customer_id: null,
    user_list: null,
    name: null,
    segment_count: 0,
    member_count: 0,
    added_count: 0,
    removed_count: 0,
    size_for_search: null,
    size_for_display: null,
    match_rate: null,
    match_rate_range: null,
    eligible_for_search: null,
    eligible_for_display: null,
    membership_status: null,
    google_checked_at: null,
    last_request_id: null,
    last_refresh_at: null,
    last_refresh_status: null,
    last_error: null,
  }
}

export async function saveAudienceSetting(segment: Segment, enabled: boolean, params: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO ads_audiences (segment, enabled, params, updated_at) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (segment) DO UPDATE SET enabled = EXCLUDED.enabled, params = EXCLUDED.params, updated_at = now()`,
    [segment, enabled, JSON.stringify(params)]
  )
}

export const listName = (segment: Segment) => `${SEGMENT_DEFS[segment].label} (store customers)`

/** The CRM_BASED list for a segment, created on first use (or adopted when one with the name exists). */
export async function ensureUserList(ads: GoogleAdsClient, segment: Segment, actor: ChangeActor): Promise<string> {
  const name = listName(segment)
  try {
    const out = await runMutation(
      {
        action: 'audience.create',
        entityType: 'audience',
        entityId: segment,
        summary: `Created Customer Match list "${name}"`,
        request: { segment, name },
        operations: [
          {
            userListOperation: {
              create: {
                name,
                description: SEGMENT_DEFS[segment].use,
                membershipStatus: 'OPEN',
                membershipLifeSpan: MEMBERSHIP_DAYS,
                crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' },
              },
            },
          },
        ],
        labels: [`List ${name}`],
      },
      actor,
      { client: ads }
    )
    const rn = out.resourceNames[0]
    if (!rn) throw new Error('Google returned no user list')
    return rn
  } catch (e) {
    if (e instanceof AdsMutationError && e.problems.some(p => /DUPLICATE_NAME|NAME_ALREADY_USED/.test(p.code))) {
      const found = await ads.searchStream(
        `SELECT user_list.resource_name FROM user_list WHERE user_list.name = '${name.replace(/'/g, "\\'")}'`
      )
      const rn = found[0]?.userList?.resourceName
      if (rn) return String(rn)
    }
    throw e
  }
}

interface Uploaded {
  user_id: string
  identifiers: DataManagerIdentifier[]
  fingerprint: string
}

function chunks<T>(list: T[], size = MEMBERS_PER_REQUEST): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const CONSENT = { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' } as const

export interface AudienceUploader {
  ingest(destination: ReturnType<typeof adsDestination>, members: DataManagerIdentifier[][]): Promise<string | null>
  remove(destination: ReturnType<typeof adsDestination>, members: DataManagerIdentifier[][]): Promise<string | null>
  status(requestId: string): Promise<string | null>
}

/** audienceMembers:ingest / remove on the connection's Data Manager credentials. */
export function dataManagerUploader(dm: DataManagerClient): AudienceUploader {
  const body = (destination: ReturnType<typeof adsDestination>, members: DataManagerIdentifier[][]) => ({
    destinations: [destination],
    audienceMembers: members.map(userIdentifiers => ({ userData: { userIdentifiers } })),
    encoding: 'HEX',
  })
  return {
    async ingest(destination, members) {
      const r = await dm.request<{ requestId?: string }>('POST', '/audienceMembers:ingest', {
        ...body(destination, members),
        consent: CONSENT,
        termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
      })
      return r?.requestId ?? null
    },
    async remove(destination, members) {
      const r = await dm.request<{ requestId?: string }>('POST', '/audienceMembers:remove', body(destination, members))
      return r?.requestId ?? null
    },
    async status(requestId) {
      const r = await dm.retrieveRequestStatus(requestId)
      const s = (r?.requestStatusPerDestination ?? [])[0] as any
      return s?.audienceMembersIngestionStatus?.userDataIngestionStatus?.uploadMatchRateRange ?? null
    },
  }
}

async function syncSegment(
  db: Db,
  ads: GoogleAdsClient,
  up: AudienceUploader,
  row: AudienceRow,
  actor: ChangeActor
): Promise<SegmentResult> {
  const segment = row.segment
  const sameAccount = !!row.customer_id && normalizeCustomerId(row.customer_id) === ads.customerId
  const uploaded = sameAccount
    ? (((await db.query(`SELECT user_id::text, identifiers, fingerprint FROM ads_audience_members WHERE segment = $1`, [segment])) as any).rows as Uploaded[])
    : []
  if (!sameAccount) await db.query(`DELETE FROM ads_audience_members WHERE segment = $1`, [segment])

  const listFor = async () => (sameAccount && row.user_list ? row.user_list : await ensureUserList(ads, segment, actor))

  if (!row.enabled) {
    if (!uploaded.length || !row.user_list) return { segment, status: 'disabled', inSegment: 0, members: 0, added: 0, removed: 0 }
    const dest = adsDestination({ operating: ads.customerId, login: ads.loginCustomerId, actionId: idFrom(row.user_list) })
    for (const part of chunks(uploaded)) await up.remove(dest, part.map(u => u.identifiers))
    await db.query(`DELETE FROM ads_audience_members WHERE segment = $1`, [segment])
    await db.query(`UPDATE ads_audiences SET member_count = 0, removed_count = $2, last_refresh_at = now(), last_refresh_status = 'disabled', updated_at = now() WHERE segment = $1`, [segment, uploaded.length])
    return { segment, status: 'disabled', inSegment: 0, members: 0, added: 0, removed: uploaded.length }
  }

  const q = segmentQuery(segment, segmentParams(segment, row.params))
  const rows = ((await db.query(q.sql, q.values)) as any).rows as SegmentRow[]
  const members = toMembers(rows)
  const diff = diffMembers(members, uploaded)
  const userList = await listFor()
  const dest = adsDestination({ operating: ads.customerId, login: ads.loginCustomerId, actionId: idFrom(userList) })

  for (const part of chunks(diff.remove)) {
    await up.remove(dest, part.map(m => m.identifiers))
    await db.query(`DELETE FROM ads_audience_members WHERE segment = $1 AND user_id = ANY($2::uuid[])`, [segment, part.map(m => m.userId)])
  }
  let requestId: string | null = null
  for (const part of chunks(diff.add)) {
    requestId = (await up.ingest(dest, part.map(m => m.identifiers))) ?? requestId
    await db.query(
      `INSERT INTO ads_audience_members (segment, user_id, identifiers, fingerprint, uploaded_at)
       SELECT $1, u, i::jsonb, f, now() FROM UNNEST($2::uuid[], $3::text[], $4::text[]) AS t(u, i, f)
       ON CONFLICT (segment, user_id) DO UPDATE SET identifiers = EXCLUDED.identifiers, fingerprint = EXCLUDED.fingerprint, uploaded_at = now()`,
      [segment, part.map(m => m.userId), part.map(m => JSON.stringify(m.identifiers)), part.map(m => m.fingerprint)]
    )
  }
  await db.query(
    `INSERT INTO ads_audiences (segment, enabled, params, customer_id, user_list, name, segment_count, member_count, added_count,
       removed_count, last_request_id, last_refresh_at, last_refresh_status, last_error, updated_at)
     VALUES ($1, true, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, now(), 'success', NULL, now())
     ON CONFLICT (segment) DO UPDATE SET customer_id = EXCLUDED.customer_id, user_list = EXCLUDED.user_list, name = EXCLUDED.name,
       segment_count = EXCLUDED.segment_count, member_count = EXCLUDED.member_count, added_count = EXCLUDED.added_count,
       removed_count = EXCLUDED.removed_count, last_request_id = COALESCE(EXCLUDED.last_request_id, ads_audiences.last_request_id),
       last_refresh_at = now(), last_refresh_status = 'success', last_error = NULL, updated_at = now()`,
    [segment, JSON.stringify(row.params ?? {}), ads.customerId, userList, listName(segment), rows.length, members.length, diff.add.length, diff.remove.length, requestId]
  )
  return { segment, status: 'success', inSegment: rows.length, members: members.length, added: diff.add.length, removed: diff.remove.length }
}

const LIST_FIELDS_FULL = `user_list.resource_name, user_list.membership_status, user_list.size_for_search, user_list.size_for_display,
  user_list.match_rate_percentage, user_list.eligible_for_search, user_list.eligible_for_display`

/** Sizes, match rate and eligibility as Google reports them (sizes stay 0 until 100 members). */
export async function readListStats(ads: GoogleAdsClient, lists: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  const valid = lists.filter(l => /^customers\/\d+\/userLists\/\d+$/.test(l))
  if (!valid.length) return out
  const where = `WHERE user_list.resource_name IN (${valid.map(l => `'${l}'`).join(', ')})`
  let rows: any[]
  try {
    rows = await ads.searchStream(`SELECT ${LIST_FIELDS_FULL} FROM user_list ${where}`)
  } catch {
    rows = await ads.searchStream(`SELECT user_list.resource_name, user_list.membership_status FROM user_list ${where}`)
  }
  for (const r of rows) if (r.userList?.resourceName) out.set(String(r.userList.resourceName), r.userList)
  return out
}

async function recordGoogleStats(db: Db, ads: GoogleAdsClient, up: AudienceUploader | null) {
  const rows = await loadAudienceRows(db)
  const lists = rows.filter(r => r.user_list && normalizeCustomerId(r.customer_id) === ads.customerId)
  const stats = await readListStats(ads, lists.map(r => r.user_list!)).catch(() => new Map<string, Record<string, any>>())
  for (const r of lists) {
    const s = stats.get(r.user_list!)
    const range = up && r.last_request_id ? await up.status(r.last_request_id).catch(() => null) : null
    const num = (v: unknown) => (v == null ? null : Number(v))
    await db.query(
      `UPDATE ads_audiences SET size_for_search = $2, size_for_display = $3, match_rate = $4, eligible_for_search = $5,
         eligible_for_display = $6, membership_status = $7, match_rate_range = COALESCE($8, match_rate_range), google_checked_at = now()
       WHERE segment = $1`,
      [
        r.segment,
        num(s?.sizeForSearch),
        num(s?.sizeForDisplay),
        num(s?.matchRatePercentage),
        s?.eligibleForSearch ?? null,
        s?.eligibleForDisplay ?? null,
        s?.membershipStatus ?? null,
        range,
      ]
    )
  }
}

/** Refresh every enabled segment of the current store. Throws AudienceRefreshInProgressError on overlap. */
export async function refreshAudiences(
  opts: { client?: GoogleAdsClient; uploader?: AudienceUploader; actor?: ChangeActor; only?: Segment } = {}
): Promise<AudienceRunResult> {
  const conn = await getClient()
  const db: Db = conn
  let locked = false
  let unlockFailed = false
  const actor = opts.actor ?? { adminId: null, email: 'scheduled audience refresh' }
  try {
    locked = !!((await conn.query('SELECT pg_try_advisory_lock($1) AS acquired', [ADS_AUDIENCES_LOCK_KEY])).rows[0] as any)?.acquired
    if (!locked) throw new AudienceRefreshInProgressError()
    const rows = (await loadAudienceRows(db)).filter(r => !opts.only || r.segment === opts.only)
    const active = rows.filter(r => r.enabled || r.member_count > 0)
    if (!active.length) return { status: 'nothing_enabled', segments: [] }
    if (!(await customerMatchTermsAcceptedAt())) return { status: 'needs_terms', segments: [] }

    let ads: GoogleAdsClient
    let up: AudienceUploader
    try {
      const creds = opts.client && opts.uploader ? null : await resolveGoogleAdsCreds()
      ads = opts.client ?? googleAdsClientFromCreds(creds!)
      up = opts.uploader ?? dataManagerUploader(dataManagerClientFor(creds!))
    } catch (e: any) {
      return { status: 'error', segments: [], error: String(e?.message ?? e).slice(0, 500) }
    }

    const results: SegmentResult[] = []
    for (const row of active) {
      try {
        results.push(await syncSegment(db, ads, up, row, actor))
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 500)
        results.push({ segment: row.segment, status: 'error', inSegment: 0, members: row.member_count, added: 0, removed: 0, error: msg })
        await db
          .query(
            `INSERT INTO ads_audiences (segment, enabled, last_refresh_at, last_refresh_status, last_error) VALUES ($1, $2, now(), 'error', $3)
             ON CONFLICT (segment) DO UPDATE SET last_refresh_at = now(), last_refresh_status = 'error', last_error = EXCLUDED.last_error, updated_at = now()`,
            [row.segment, row.enabled, msg]
          )
          .catch(() => {})
        // A credential or scope problem fails every list the same way.
        if (e instanceof DataManagerApiError && !e.retryable && e.httpStatus !== 400) break
      }
    }
    await recordGoogleStats(db, ads, up).catch(() => {})
    const errors = results.filter(r => r.status === 'error').length
    return {
      status: errors === 0 ? 'success' : errors === results.length ? 'error' : 'partial',
      segments: results,
      error: results.find(r => r.error)?.error,
    }
  } finally {
    if (locked) {
      await conn.query('SELECT pg_advisory_unlock($1)', [ADS_AUDIENCES_LOCK_KEY]).catch(() => {
        unlockFailed = true
      })
    }
    conn.release(unlockFailed || undefined)
  }
}

export interface AudienceView {
  segment: Segment
  label: string
  description: string
  use: string
  enabled: boolean
  params: Record<string, number>
  userList: string | null
  listId: string | null
  inSegment: number
  members: number
  added: number
  removed: number
  sizeForSearch: number | null
  sizeForDisplay: number | null
  matchRate: number | null
  matchRateRange: string | null
  eligibleForSearch: boolean | null
  eligibleForDisplay: boolean | null
  membershipStatus: string | null
  lastRefreshAt: string | null
  lastRefreshStatus: string | null
  lastError: string | null
  googleCheckedAt: string | null
  available: boolean
}

export interface AudiencesData {
  audiences: AudienceView[]
  termsAcceptedAt: string | null
  minActiveMembers: number
  membershipDays: number
  campaigns: { campaignId: string; name: string; channelType: string | null; status: string | null }[]
}

export async function loadAudiences(): Promise<AudiencesData> {
  const [rows, terms, campaigns, b2b] = await Promise.all([
    loadAudienceRows().catch(() => SEGMENTS.map(emptyRow)),
    customerMatchTermsAcceptedAt(),
    queryMany<{ campaign_id: string; name: string; channel_type: string | null; status: string | null }>(
      `SELECT campaign_id::text, name, channel_type, status FROM ads_campaigns
       WHERE channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX') AND status IN ('ENABLED', 'PAUSED') ORDER BY name`
    ).catch(() => []),
    queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM business_profiles WHERE approval_status = 'approved'`).catch(() => null),
  ])
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    termsAcceptedAt: terms,
    minActiveMembers: MIN_ACTIVE_MEMBERS,
    membershipDays: MEMBERSHIP_DAYS,
    campaigns: campaigns.map(c => ({ campaignId: c.campaign_id, name: c.name, channelType: c.channel_type, status: c.status })),
    audiences: rows.map(r => {
      const p = segmentParams(r.segment, r.params)
      const def = SEGMENT_DEFS[r.segment]
      return {
        segment: r.segment,
        label: def.label,
        description: def.description(p),
        use: def.use,
        enabled: r.enabled,
        params: p,
        userList: r.user_list,
        listId: r.user_list ? idFrom(r.user_list) : null,
        inSegment: r.segment_count,
        members: r.member_count,
        added: r.added_count,
        removed: r.removed_count,
        sizeForSearch: num(r.size_for_search),
        sizeForDisplay: num(r.size_for_display),
        matchRate: r.match_rate,
        matchRateRange: r.match_rate_range,
        eligibleForSearch: r.eligible_for_search,
        eligibleForDisplay: r.eligible_for_display,
        membershipStatus: r.membership_status,
        lastRefreshAt: r.last_refresh_at,
        lastRefreshStatus: r.last_refresh_status,
        lastError: r.last_error,
        googleCheckedAt: r.google_checked_at,
        available: r.segment !== 'b2b' || (b2b?.n ?? 0) > 0,
      }
    }),
  }
}
