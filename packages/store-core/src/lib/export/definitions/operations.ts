import 'server-only'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { listServiceAccounts } from '@/lib/auth/service-accounts-list'
import { certStatus, getAllAdmins, overlayPortalState } from '@/lib/auth/team-members'
import { listLocations, listWarehouses } from '@/lib/catalog/shelf'
import { inflationLogs } from '@/lib/catalog/inflation-log'
import { getImportJob, isUuid, pageImportJobs, resolveImportTenantId, type ImportJob, type JobListFilter } from '@/lib/import/jobs'
import { getDashboardActivity, getDashboardAnalytics, type AnalyticsRange } from '@/lib/queries'
import { loadAmazonOrders } from '@/lib/amazon/orders'
import { loadStock as loadAmazonStock } from '@/lib/amazon/stock'
import { QUEUE_BUCKETS, listReturns, queueOrders, type QueueBucket } from '@/lib/marketplace/console'
import { toListingUnitView } from '@/lib/marketplace/catalog-routes'
import { loadSellableUnits } from '@/lib/marketplace/catalog-load'
import { loadChannelSettlements } from '@/lib/marketplace/settlements'
import { loadInventory } from '@/lib/marketplace/stock'
import { CHANNEL_LABEL, MARKETPLACE_CHANNELS, type MarketplaceChannel } from '@/lib/marketplace/types'
import { pageProposedTools } from '@/lib/admin-agent/proposed-tools-list'
import { loadPickupLists } from '@/lib/shipping/delhivery-pickups'
import { queryMany } from '@/lib/shared/db'
import { listInbox, type InboxFilter } from '@/lib/support/sessions'
import type { SupportChannel } from '@/lib/support/types'
import { defineExport, type ExportDefinition, type ExportRunContext, type ExportSection } from '../define'
import { ExportError } from '../pipeline'
import { narrowed, type DateRange, type ExportColumn, type ExportFilter } from '../types'

// Operations exports: import history, dashboard activity, team, service accounts, Delhivery, support,
// agent, price inflation, shelving and the marketplace consoles. Each calls the same lib function as
// the page's API route (or server component), so exported totals are the page's totals; include/exclude
// choices are applied to the rows (or passed to the function) before totals are computed.

const ALL_SCOPES = ['filtered', 'page', 'selected', 'all'] as const

const money = (key: string, label: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'money', total: 'sum', ...extra })
const int = (key: string, label: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'int', total: 'sum', ...extra })

const multi = (key: string, label: string, options: Record<string, string>, help?: string, preticked?: string[]): ExportFilter => ({
  key,
  label,
  kind: 'multi',
  options: Object.entries(options).map(([value, l]) => ({ value, label: l })),
  default: preticked,
  help,
})

const keep = <T,>(rows: T[], picked: string[] | null, get: (r: T) => string) => (picked ? rows.filter(r => picked.includes(get(r))) : rows)
/** Rows for the page / selected scopes (by record id); every row otherwise. */
const onlyIds = <T,>(rows: T[], ctx: ExportRunContext, id: (r: T) => string) => {
  if (!ctx.ids) return rows
  const set = new Set(ctx.ids)
  return rows.filter(r => set.has(id(r)))
}
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '')
const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const DAY = /^\d{4}-\d{2}-\d{2}$/

function rangeFromQuery(q: URLSearchParams): DateRange | undefined {
  const from = q.get('from') ?? undefined
  const to = q.get('to') ?? undefined
  return from || to ? { from, to } : undefined
}

/** The plan gate the marketplace routes add after the scope check. */
async function planGate(scope: string, what: string) {
  const gate = await currentTenantPlanGate(scope)
  if (!gate.allowed) throw new ExportError(`${what} needs the ${humanize(gate.upgradeRequired ?? 'pro')} plan.`, 403)
}

// ── Data Source: import history ─────────────────────────────────────────────

const JOB_STATUS: Record<string, string> = { active: 'Running', with_errors: 'With errors', done: 'Clean', failed: 'Failed' }
const JOB_SOURCE: Record<string, string> = { upload: 'File upload', google_sheet: 'Google Sheet sync' }
const JOB_STATUS_FILTER = multi('status', 'Import status', JOB_STATUS, 'Untick a status to leave those imports out.')
const JOB_SOURCE_FILTER = multi('source', 'Source', JOB_SOURCE)

const jobState = (j: Pick<ImportJob, 'status' | 'error_count'>) =>
  j.status === 'pending' ? 'Queued' : j.status === 'running' ? 'Running' : j.status === 'failed' ? 'Failed' : j.error_count > 0 ? 'Done with errors' : 'Done'

/** The history page's list, one status/source at a time (what its API takes), merged newest first. */
async function importJobs(ctx: ExportRunContext): Promise<ImportJob[]> {
  const tenantId = await resolveImportTenantId()
  const statuses = (narrowed(JOB_STATUS_FILTER, ctx.filters) ?? ['all']) as (JobListFilter | 'all')[]
  const sources = (narrowed(JOB_SOURCE_FILTER, ctx.filters) ?? ['all']) as ('upload' | 'google_sheet' | 'all')[]
  const out = new Map<string, ImportJob>()
  for (const status of statuses) {
    for (const source of sources) {
      for (let offset = 0; out.size < ctx.cap; offset += 100) {
        const { jobs, total } = await pageImportJobs(tenantId, { limit: 100, offset, status, source })
        for (const j of jobs) out.set(j.id, j)
        if (!jobs.length || offset + jobs.length >= total) break
      }
    }
  }
  return [...out.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

export const DATA_SOURCE_JOBS_EXPORT = defineExport({
  key: 'data-source.jobs',
  title: 'Product imports',
  noun: 'Imports',
  scope: 'products:read',
  columns: [
    { key: 'created_at', label: 'Started', type: 'datetime', id: true },
    { key: 'source', label: 'Source', id: true },
    { key: 'state', label: 'Status' },
    int('total_rows', 'Rows'),
    int('processed_rows', 'Processed'),
    int('created_count', 'Created'),
    int('updated_count', 'Updated'),
    int('error_count', 'Failed'),
    { key: 'duration_s', label: 'Duration (s)', type: 'int', total: 'avg' },
    { key: 'finished_at', label: 'Finished', type: 'datetime', optional: true },
    int('images_total', 'Images', { optional: true }),
    int('images_fetched', 'Images fetched', { optional: true }),
    int('images_failed', 'Images failed', { optional: true }),
    { key: 'last_error', label: 'Last error', optional: true, width: 2 },
    { key: 'spreadsheet_id', label: 'Spreadsheet', optional: true },
    { key: 'id', label: 'Import ID', optional: true, width: 1.6 },
  ],
  filters: [JOB_STATUS_FILTER, JOB_SOURCE_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const rows = (await importJobs(ctx)).map(j => {
      const img = (j.image_progress ?? {}) as Partial<ImportJob['image_progress']>
      const dur = j.finished_at ? Math.max(0, Math.round((new Date(j.finished_at).getTime() - new Date(j.created_at).getTime()) / 1000)) : null
      return {
        ...j,
        source: JOB_SOURCE[j.source] ?? j.source,
        state: jobState(j),
        duration_s: dur,
        images_total: img.total ?? 0,
        images_fetched: img.fetched ?? 0,
        images_failed: img.failed ?? 0,
      }
    })
    return [{ key: 'jobs', rows }]
  },
})

const OUTCOME: Record<string, string> = { error: 'Failed', warning: 'Warnings', created: 'Created', updated: 'Updated', deleted: 'Removed' }
const OUTCOME_FILTER = multi('outcomes', 'Row outcomes', OUTCOME, 'Failed and warning rows are the ones to fix in the sheet and upload again.')

export const DATA_SOURCE_JOB_ROWS_EXPORT = defineExport({
  key: 'data-source.job-rows',
  title: 'Import row results',
  noun: 'Rows',
  scope: 'products:read',
  columns: [
    { key: 'sheet', label: 'Sheet', id: true },
    { key: 'row', label: 'Row', type: 'int', id: true },
    { key: 'sku', label: 'SKU', id: true },
    { key: 'outcome', label: 'Outcome' },
    { key: 'message', label: 'Detail', width: 3 },
  ],
  filters: [OUTCOME_FILTER],
  scopes: ['filtered'],
  filename: ctx => `import-${(ctx.query.get('job') ?? '').slice(0, 8) || 'rows'}`,
  describe: ctx => [`Import ${(ctx.query.get('job') ?? '').slice(0, 8)}`],
  sections: async ctx => {
    const id = ctx.query.get('job') ?? ''
    const job = isUuid(id) ? await getImportJob(id, await resolveImportTenantId()) : null
    if (!job) throw new ExportError('Import not found.', 404)
    const picked = narrowed(OUTCOME_FILTER, ctx.filters)
    const rows = keep(job.row_results ?? [], picked, r => r.outcome).map(r => ({ sheet: r.sheet ?? '', row: r.row || null, sku: r.sku ?? '', outcome: OUTCOME[r.outcome] ?? r.outcome, message: r.message ?? '' }))
    return [
      {
        key: 'rows',
        rows,
        totals: null,
        summary: [
          { label: 'Created', value: job.created_count, type: 'int' },
          { label: 'Updated', value: job.updated_count, type: 'int' },
          { label: 'Failed', value: job.error_count, type: 'int' },
          { label: 'Rows exported', value: rows.length, type: 'int' },
        ],
      },
    ]
  },
})

// ── Dashboard ───────────────────────────────────────────────────────────────

const ACTIVITY_CHANNELS: Record<string, string> = { online: 'Online', cod: 'COD', business: 'Business' }
const ACTIVITY_CHANNEL_FILTER = multi('channels', 'Channels', ACTIVITY_CHANNELS, 'Untick a channel to leave its orders out; with all ticked the figures are the "All channels" view.')
const WEEKS = [13, 26, 52]
const weeksOf = (q: URLSearchParams) => (WEEKS.includes(Number(q.get('weeks'))) ? Number(q.get('weeks')) : 26)

export const DASHBOARD_ACTIVITY_EXPORT = defineExport({
  key: 'dashboard.activity',
  title: 'Orders shipped',
  noun: 'Days',
  scope: 'dashboard:read',
  columns: [
    { key: 'date', label: 'Date', type: 'date', id: true },
    { key: 'channel', label: 'Channel', id: true },
    int('shipped', 'Shipped'),
    int('placed', 'Placed'),
    { key: 'customers', label: 'Customers', type: 'int' },
    { key: 'top', label: 'Top categories', optional: true, width: 2 },
  ],
  filters: [ACTIVITY_CHANNEL_FILTER],
  scopes: ['filtered'],
  period: ctx => `Last ${weeksOf(ctx.query)} weeks`,
  sections: async ctx => {
    const weeks = weeksOf(ctx.query)
    const picked = narrowed(ACTIVITY_CHANNEL_FILTER, ctx.filters)
    const channels = (picked ?? ['all']) as ('all' | 'online' | 'cod' | 'business')[]
    const acts = await Promise.all(channels.map(channel => getDashboardActivity({ weeks, channel })))
    const label = (c: string) => (c === 'all' ? 'All channels' : (ACTIVITY_CHANNELS[c] ?? c))
    const today = istToday()
    const days = acts.flatMap((a, i) =>
      a.days.filter(d => d.date <= today).map(d => ({ date: d.date, channel: label(channels[i]), shipped: d.shipped, placed: d.placed, customers: d.customers, top: d.top.map(t => `${t.name}: ${t.count}`).join(' | ') }))
    )
    const first = acts[0]
    const one = acts.length === 1 && first
    return [
      {
        key: 'days',
        title: 'Orders shipped per day',
        rows: days,
        summary: one
          ? [
              { label: 'Busiest day', value: first.totals.busiestDay ? `${first.totals.busiestDay.date} (${first.totals.busiestDay.count})` : '' },
              { label: 'Longest streak (days)', value: first.totals.longestStreak, type: 'int' },
              { label: 'Current streak (days)', value: first.totals.currentStreak, type: 'int' },
              { label: 'Median days to ship', value: first.medianDaysToShip, type: 'number' },
              { label: 'Shipped within 2 days', value: first.shippedWithin2dPct, type: 'percent' },
              { label: 'Backlog (placed, not shipped)', value: first.backlog, type: 'int' },
            ]
          : undefined,
      },
      {
        key: 'products',
        title: 'Top products shipped',
        columns: [
          { key: 'name', label: 'Product', id: true, width: 2 },
          { key: 'channel', label: 'Channel', id: true },
          int('shipped', 'Shipped'),
          { key: 'onTimePct', label: 'On time', type: 'percent' },
          { key: 'avgDays', label: 'Avg days to ship', type: 'number' },
        ],
        rows: acts.flatMap((a, i) => a.topProducts.map(p => ({ name: p.name, channel: label(channels[i]), shipped: p.shipped, onTimePct: p.onTimePct, avgDays: p.avgDays }))),
      },
    ]
  },
})

const DASH_RANGE: Record<string, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', month: 'This month', year: 'Last 12 months' }
const rangeOf = (q: URLSearchParams): AnalyticsRange => (Object.hasOwn(DASH_RANGE, q.get('range') ?? '') ? (q.get('range') as AnalyticsRange) : '30d')
const DASH_TABLES: Record<string, string> = { trend: 'Revenue trend', categories: 'Top categories', brands: 'Top brands' }
const DASH_TABLES_FILTER = multi('tables', 'Tables', DASH_TABLES)

export const DASHBOARD_ANALYTICS_EXPORT = defineExport({
  key: 'dashboard.analytics',
  title: 'Dashboard analytics',
  noun: 'Rows',
  scope: 'dashboard:read',
  columns: [{ key: 'label', label: 'Period', id: true }, money('revenue', 'Revenue (paid)'), int('orders', 'Orders'), int('paidOrders', 'Paid orders'), { key: 'customers', label: 'Customers', type: 'int' }, int('units', 'Units'), money('aov', 'Average order value', { total: undefined })],
  filters: [DASH_TABLES_FILTER],
  scopes: ['filtered'],
  period: ctx => DASH_RANGE[rangeOf(ctx.query)],
  sections: async ctx => {
    const d = await getDashboardAnalytics(rangeOf(ctx.query))
    const tables = narrowed(DASH_TABLES_FILTER, ctx.filters) ?? Object.keys(DASH_TABLES)
    const k = d.kpis
    const out: ExportSection[] = []
    if (tables.includes('trend'))
      out.push({
        key: 'trend',
        title: `Revenue trend by ${d.trendBucket}`,
        rows: d.trend,
        summary: [
          { label: 'Revenue', value: k.revenue, type: 'money' },
          { label: 'Orders', value: k.orders, type: 'int' },
          { label: 'Average order value', value: k.aov, type: 'money' },
          { label: 'Customers', value: k.customers, type: 'int' },
        ],
      })
    const ranked = (key: string, title: string, rows: { name: string; units: number; revenue: number }[]): ExportSection => ({
      key,
      title,
      columns: [{ key: 'name', label: 'Name', id: true, width: 2 }, int('units', 'Units'), money('revenue', 'Revenue')],
      rows,
    })
    if (tables.includes('categories')) out.push(ranked('categories', 'Top categories', d.topCategories))
    if (tables.includes('brands')) out.push(ranked('brands', 'Top brands', d.topBrands))
    return out
  },
})

// ── Settings: team and service accounts ─────────────────────────────────────

const CERT_STATUS: Record<string, string> = { Active: 'Active', 'Pending Download': 'Pending download', Revoked: 'Revoked', Expired: 'Expired', 'No Certificate': 'No certificate' }
const ACTIVE_STATE: Record<string, string> = { active: 'Active', inactive: 'Inactive' }
const TEAM_STATE_FILTER = multi('state', 'Member state', ACTIVE_STATE)
const TEAM_CERT_FILTER = multi('certificate', 'Certificate', CERT_STATUS)
const TEAM_ROLES = async (): Promise<ExportFilter> => {
  const rows = await queryMany<{ role: string }>(`SELECT DISTINCT role FROM admins WHERE role IS DISTINCT FROM 'service_account' AND role IS NOT NULL ORDER BY role`, []).catch(() => [])
  return { key: 'role', label: 'Roles', kind: 'multi', options: rows.map(r => ({ value: r.role, label: humanize(r.role) })) }
}

export const TEAM_EXPORT = defineExport({
  key: 'team.members',
  title: 'Team members',
  noun: 'Members',
  scope: 'settings:read',
  columns: [
    { key: 'name', label: 'Member', id: true, width: 1.6 },
    { key: 'role', label: 'Role' },
    { key: 'state', label: 'State' },
    { key: 'certificate', label: 'Certificate' },
    { key: 'mfa_enabled', label: 'MFA on', type: 'bool' },
    { key: 'last_login', label: 'Last sign-in', type: 'datetime' },
    { key: 'created_at', label: 'Added', type: 'datetime' },
    { key: 'scope_count', label: 'Scopes', type: 'int', optional: true },
    { key: 'scopes', label: 'Scope keys', optional: true, width: 3 },
    { key: 'idle_timeout_minutes', label: 'Idle timeout (min)', type: 'int', optional: true },
    { key: 'mobile_hint', label: 'Mobile (masked)', optional: true },
    { key: 'recovery_codes', label: 'MFA recovery codes left', type: 'int', optional: true },
  ],
  filters: async () => [await TEAM_ROLES(), TEAM_STATE_FILTER, TEAM_CERT_FILTER],
  scopes: [...ALL_SCOPES],
  sections: async ctx => {
    if (!isPlatformOwner(ctx.admin.role)) throw new ExportError('Only the store owner can export the team.', 403)
    const admins = (await getAllAdmins()) as any[]
    await overlayPortalState(admins)
    const roleFilter = (await TEAM_ROLES()) as ExportFilter
    const roles = narrowed(roleFilter, ctx.filters)
    const states = narrowed(TEAM_STATE_FILTER, ctx.filters)
    const certs = narrowed(TEAM_CERT_FILTER, ctx.filters)
    let rows = admins.map(a => ({ ...a, cert: certStatus(a), st: a.is_active !== false ? 'active' : 'inactive' }))
    rows = keep(keep(keep(rows, roles, a => String(a.role)), states, a => a.st), certs, a => a.cert)
    rows = onlyIds(rows, ctx, a => String(a.id))
    return [
      {
        key: 'members',
        rows: rows.map(a => ({
          name: a.first_name && a.last_name ? `${a.first_name} ${a.last_name}` : a.username,
          role: humanize(String(a.role ?? '')),
          state: ACTIVE_STATE[a.st],
          certificate: CERT_STATUS[a.cert] ?? a.cert,
          mfa_enabled: !!a.mfa_enabled,
          last_login: a.last_login,
          created_at: a.created_at,
          scope_count: Array.isArray(a.scopes) ? a.scopes.length : 0,
          scopes: list(a.scopes),
          idle_timeout_minutes: a.idle_timeout_minutes,
          mobile_hint: a.mobile_hint ?? '',
          recovery_codes: num(a.mfa_recovery_codes_remaining) ?? 0,
        })),
        totals: null,
      },
    ]
  },
})

const SA_STATE_FILTER = multi('state', 'Account state', { active: 'Active', revoked: 'Revoked' })
const SA_NEVER_USED: ExportFilter = { key: 'never_used', label: 'Only active accounts never used', kind: 'toggle', default: false }

// Keys, tokens and certificates are never exported; only the account's identity, scopes and usage.
export const SERVICE_ACCOUNTS_EXPORT = defineExport({
  key: 'service-accounts.list',
  title: 'Service accounts',
  noun: 'Accounts',
  scope: 'service_accounts:read',
  columns: [
    { key: 'name', label: 'Account', id: true, width: 1.5 },
    { key: 'common_name', label: 'Certificate CN', width: 1.5 },
    { key: 'state', label: 'State' },
    { key: 'scope_count', label: 'Scopes', type: 'int' },
    { key: 'p12_downloaded', label: 'Certificate downloaded', type: 'bool' },
    { key: 'created_at', label: 'Created', type: 'datetime' },
    { key: 'last_used_at', label: 'Last used', type: 'datetime' },
    { key: 'revoked_at', label: 'Revoked', type: 'datetime', optional: true },
    { key: 'scopes', label: 'Scope keys', optional: true, width: 3 },
  ],
  filters: [SA_STATE_FILTER, SA_NEVER_USED],
  scopes: [...ALL_SCOPES],
  sections: async ctx => {
    let rows = (await listServiceAccounts()) as any[]
    rows = keep(rows, narrowed(SA_STATE_FILTER, ctx.filters), a => (a.is_revoked ? 'revoked' : 'active'))
    if (ctx.filters.never_used === true) rows = rows.filter(a => !a.is_revoked && !a.last_used_at)
    rows = onlyIds(rows, ctx, a => String(a.id))
    return [
      {
        key: 'accounts',
        rows: rows.map(a => ({
          name: a.name,
          common_name: a.common_name,
          state: a.is_revoked ? 'Revoked' : 'Active',
          scope_count: (a.allowed_scopes ?? []).length,
          p12_downloaded: !!a.p12_downloaded,
          created_at: a.created_at,
          last_used_at: a.last_used_at,
          revoked_at: a.revoked_at,
          scopes: list(a.allowed_scopes),
        })),
        totals: null,
        summary: [
          { label: 'Active', value: rows.filter(a => !a.is_revoked).length, type: 'int' },
          { label: 'Revoked', value: rows.filter(a => a.is_revoked).length, type: 'int' },
        ],
      },
    ]
  },
})

// ── Delhivery ───────────────────────────────────────────────────────────────

const PICKUP_STATUS: Record<string, string> = { pending: 'Pending', picked_up: 'Picked up', failed: 'Failed', rescheduled: 'Rescheduled' }
const PICKUP_FILTER = multi('status', 'Pickup status', PICKUP_STATUS)

export const DELHIVERY_PICKUPS_EXPORT = defineExport({
  key: 'delhivery.pickups',
  title: 'Delhivery pickup requests',
  noun: 'Pickups',
  scope: 'delhivery:read',
  columns: [
    { key: 'pickup_date', label: 'Pickup date', type: 'date', id: true },
    { key: 'pickup_id', label: 'Delhivery ID', id: true },
    { key: 'status', label: 'Status' },
    int('awb_count', 'AWBs'),
    { key: 'created_at', label: 'Requested', type: 'datetime' },
    { key: 'awbs', label: 'AWB numbers', optional: true, width: 3 },
  ],
  filters: [PICKUP_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const { pickupHistory } = await loadPickupLists()
    let rows = keep(pickupHistory as any[], narrowed(PICKUP_FILTER, ctx.filters), r => String(r.pickup_status ?? 'pending'))
    rows = onlyIds(rows, ctx, r => String(r.id))
    return [{ key: 'pickups', rows: rows.map(r => ({ ...r, status: PICKUP_STATUS[r.pickup_status] ?? r.pickup_status, awbs: list(r.awbs) })) }]
  },
})

const eligibleStatuses = (orders: any[]): ExportFilter => ({
  key: 'status',
  label: 'Order status',
  kind: 'multi',
  options: [...new Set(orders.map(o => String(o.status)))].sort().map(s => ({ value: s, label: humanize(s) })),
})

export const DELHIVERY_ELIGIBLE_EXPORT = defineExport({
  key: 'delhivery.eligible-orders',
  title: 'Orders awaiting pickup',
  noun: 'Orders',
  scope: 'delhivery:read',
  columns: [
    { key: 'order_number', label: 'Order', id: true },
    { key: 'awb_number', label: 'AWB', id: true },
    { key: 'customer_name', label: 'Customer', width: 1.5 },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'postal_code', label: 'PIN' },
    { key: 'status', label: 'Status' },
    { key: 'created_at', label: 'Placed', type: 'datetime' },
  ],
  filters: async () => [eligibleStatuses((await loadPickupLists()).orders as any[])],
  scopes: ['filtered'],
  sections: async ctx => {
    const { orders } = await loadPickupLists()
    let rows = keep(orders as any[], narrowed(eligibleStatuses(orders as any[]), ctx.filters), o => String(o.status))
    rows = onlyIds(rows, ctx, o => String(o.id))
    return [{ key: 'orders', rows: rows.map(o => ({ ...o, status: humanize(String(o.status)) })), totals: 'auto' }]
  },
})

// ── Support ─────────────────────────────────────────────────────────────────

const SUPPORT_VIEWS: Record<string, string> = { open: 'All open', needs_human: 'Needs a person', approval: 'Needs approval', mine: 'Mine', ai: 'Assistant', closed: 'Closed' }
const SUPPORT_CHANNELS: Record<string, string> = { web: 'Website', app: 'App', whatsapp: 'WhatsApp', email: 'Email' }
const SUPPORT_VIEW_FILTER = multi('views', 'Conversations', SUPPORT_VIEWS, 'The inbox tabs; conversations in more than one ticked tab are listed once.', ['open'])
const SUPPORT_CHANNEL_FILTER = multi('channels', 'Channels', SUPPORT_CHANNELS)

export const SUPPORT_SESSIONS_EXPORT = defineExport({
  key: 'support.tickets',
  title: 'Support conversations',
  noun: 'Conversations',
  scope: 'customers:read',
  columns: [
    { key: 'ticket', label: 'Ticket', id: true },
    { key: 'created_at', label: 'Opened', type: 'datetime', id: true },
    { key: 'channel', label: 'Channel' },
    { key: 'status', label: 'Status' },
    { key: 'handler', label: 'Handled by' },
    { key: 'customer', label: 'Customer', width: 1.5 },
    { key: 'agent', label: 'Assigned to' },
    { key: 'last_message_at', label: 'Last message', type: 'datetime' },
    int('unread', 'Unread'),
    int('approvals', 'Awaiting approval'),
    { key: 'email', label: 'Email', optional: true, width: 1.5 },
    { key: 'phone', label: 'Phone', optional: true },
    { key: 'lang', label: 'Language', optional: true },
    { key: 'closed_at', label: 'Closed', type: 'datetime', optional: true },
    { key: 'handoff_reason', label: 'Handoff reason', optional: true, width: 2 },
    { key: 'handoff_summary', label: 'Handoff summary', optional: true, width: 3 },
  ],
  filters: [SUPPORT_VIEW_FILTER, SUPPORT_CHANNEL_FILTER],
  scopes: ['filtered'],
  describe: ctx => (ctx.query.get('q')?.trim() ? [`Search: ${ctx.query.get('q')!.trim()}`] : []),
  sections: async ctx => {
    const views = (narrowed(SUPPORT_VIEW_FILTER, ctx.filters) ?? Object.keys(SUPPORT_VIEWS)) as InboxFilter[]
    const channels = (narrowed(SUPPORT_CHANNEL_FILTER, ctx.filters) ?? [null]) as (SupportChannel | null)[]
    const search = ctx.query.get('q')?.trim() || undefined
    const seen = new Map<string, Awaited<ReturnType<typeof listInbox>>[number]>()
    for (const filter of views)
      for (const channel of channels) for (const s of await listInbox({ filter, adminId: ctx.admin.adminId, channel, search, limit: 200 })) seen.set(s.id, s)
    const rows = [...seen.values()]
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
      .map(s => ({
        ticket: s.ticket ?? '',
        created_at: s.createdAt,
        channel: SUPPORT_CHANNELS[s.channel] ?? s.channel,
        status: humanize(s.status),
        handler: s.handler === 'ai' ? 'Assistant' : humanize(s.handler),
        customer: s.customer.name,
        agent: s.adminName ?? '',
        last_message_at: s.lastMessageAt,
        unread: s.unread,
        approvals: s.approvals ?? 0,
        email: s.customer.email ?? '',
        phone: s.customer.phone ?? '',
        lang: s.customerLang ?? '',
        closed_at: s.closedAt,
        handoff_reason: s.handoffReason ?? '',
        handoff_summary: s.handoffSummary ?? '',
      }))
    return [{ key: 'sessions', rows }]
  },
})

// ── Agent: proposed tools ───────────────────────────────────────────────────

const TOOL_STATUS: Record<string, string> = { proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected', retired: 'Retired' }
const TOOL_STATUS_FILTER = multi('status', 'Status', TOOL_STATUS, 'Untick a status to leave those tools out.', ['proposed'])

export const AGENT_PROPOSED_TOOLS_EXPORT = defineExport({
  key: 'agent.proposed-tools',
  title: 'Agent proposed tools',
  noun: 'Tools',
  scope: 'agent:read',
  columns: [
    { key: 'name', label: 'Tool', id: true, width: 1.5 },
    { key: 'kind', label: 'Kind' },
    { key: 'status', label: 'Status' },
    { key: 'description', label: 'Description', width: 3 },
    { key: 'created_at', label: 'Proposed', type: 'datetime' },
    { key: 'decided_at', label: 'Decided', type: 'datetime' },
    int('invocation_count', 'Calls'),
    { key: 'last_invoked_at', label: 'Last called', type: 'datetime' },
    { key: 'rejection_reason', label: 'Rejection reason', optional: true, width: 2 },
    { key: 'source_prompt', label: 'Source prompt', optional: true, width: 3 },
    { key: 'sql_template', label: 'SQL template', optional: true, width: 3 },
  ],
  filters: [TOOL_STATUS_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const picked = narrowed(TOOL_STATUS_FILTER, ctx.filters)
    const out = new Map<string, any>()
    for (const status of picked ?? ['all']) {
      for (let page = 1; out.size < ctx.cap; page++) {
        const { items, total } = await pageProposedTools(status, 200, page)
        for (const t of items) out.set(t.id, t)
        if (!items.length || page * 200 >= total) break
      }
    }
    const rows = [...out.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(t => ({ ...t, kind: t.kind === 'templated_email' ? 'Email' : 'Read-only SQL', status: TOOL_STATUS[t.status] ?? t.status }))
    return [{ key: 'tools', rows }]
  },
})

// ── Price inflation ─────────────────────────────────────────────────────────

const INFLATION_KINDS: Record<string, string> = { applied: 'Applied', rollback: 'Rollbacks' }
const INFLATION_KIND_FILTER = multi('kinds', 'Entries', INFLATION_KINDS)

export const INFLATION_HISTORY_EXPORT = defineExport({
  key: 'inflation.history',
  title: 'Price inflation history',
  noun: 'Entries',
  scope: 'inflation:read',
  columns: [
    { key: 'applied_at', label: 'Applied', type: 'datetime', id: true },
    { key: 'category_name', label: 'Category', id: true, width: 1.5 },
    { key: 'kind', label: 'Entry' },
    { key: 'percentage', label: 'Increase', type: 'percent' },
    { key: 'fields', label: 'Price fields', width: 2 },
    int('product_count', 'Products'),
    { key: 'applied_by', label: 'Applied by' },
    { key: 'rolled_back_at', label: 'Rolled back', type: 'datetime' },
    { key: 'rolled_back_by', label: 'Rolled back by', optional: true },
  ],
  filters: [INFLATION_KIND_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const all: any[] = []
    for (let offset = 0; all.length < ctx.cap; offset += 100) {
      const { logs, total } = await inflationLogs(new URLSearchParams({ limit: '100', offset: String(offset) }))
      all.push(...logs)
      if (!logs.length || offset + logs.length >= (total ?? 0)) break
    }
    const rows = keep(all, narrowed(INFLATION_KIND_FILTER, ctx.filters), l => (l.is_rollback ? 'rollback' : 'applied')).map(l => ({
      ...l,
      kind: l.is_rollback ? 'Rollback' : 'Applied',
      percentage: num(l.percentage),
      fields: list(l.applied_fields),
    }))
    return [{ key: 'log', rows, totals: 'auto' }]
  },
})

// ── Shelving ────────────────────────────────────────────────────────────────

const warehouseFilter = async (): Promise<ExportFilter> => ({
  key: 'warehouses',
  label: 'Warehouses',
  kind: 'multi',
  options: (await listWarehouses()).map(w => ({ value: w.id, label: `${w.name} (${w.code})` })),
})

export const SHELVING_LOCATIONS_EXPORT = defineExport({
  key: 'shelving.locations',
  title: 'Shelf locations',
  noun: 'Locations',
  scope: 'inventory:read',
  columns: [
    { key: 'display_code', label: 'Location', id: true },
    { key: 'warehouse', label: 'Warehouse', id: true },
    { key: 'aisle_code', label: 'Aisle' },
    { key: 'rack_code', label: 'Rack' },
    { key: 'shelf_code', label: 'Shelf' },
    { key: 'bin_code', label: 'Bin' },
    int('stock_count', 'Products on shelf'),
    { key: 'state', label: 'State' },
    { key: 'notes', label: 'Notes', optional: true, width: 2 },
    { key: 'created_at', label: 'Added', type: 'datetime', optional: true },
  ],
  filters: async () => [await warehouseFilter(), { key: 'active_only', label: 'Only active locations', kind: 'toggle', default: false }],
  scopes: ['filtered'],
  sections: async ctx => {
    const picked = narrowed(await warehouseFilter(), ctx.filters)
    // One warehouse is what the page asks for; several are cut from the full list.
    let rows = await listLocations(picked?.length === 1 ? picked[0] : undefined)
    if (picked && picked.length !== 1) rows = rows.filter(l => picked.includes(l.warehouse_id))
    if (ctx.filters.active_only === true) rows = rows.filter(l => l.is_active)
    return [
      {
        key: 'locations',
        rows: rows.map(l => ({ ...l, warehouse: l.warehouse_name ? `${l.warehouse_name} (${l.warehouse_code})` : '', state: l.is_active ? 'Active' : 'Inactive', bin_code: l.bin_code ?? '' })),
      },
    ]
  },
})

// ── Marketplace consoles (Myntra, AJIO, Flipkart) ───────────────────────────

const BUCKET_LABEL: Record<QueueBucket, string> = { new: 'New', to_pack: 'To pack', rtd: 'Ready to dispatch', shipped: 'Shipped', closed: 'Cancelled / returned' }
const RETURN_LABEL: Record<string, string> = { initiated: 'Initiated', in_transit: 'In transit', received: 'Received', qc_passed: 'QC passed', qc_failed: 'QC failed', closed: 'Closed', cancelled: 'Cancelled' }
const LISTING_STATUS: Record<string, string> = { unmapped: 'Not mapped', mapped: 'Mapped', submitted: 'Submitted', live: 'Live', rejected: 'Rejected', inactive: 'Inactive' }
const STOCK_STATE: Record<string, string> = { error: 'Push errors', pending: 'Waiting to push', drift: 'Price differs', never: 'Never pushed', synced: 'In sync' }

const settlementRange = (ctx: ExportRunContext) => {
  const { from, to } = ctx.range
  if (from && to && DAY.test(from) && DAY.test(to) && from <= to) return { from, to }
  // The page's default: the last 90 days.
  return { from: new Date(Date.now() - 89 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }
}

function marketplaceExports(channel: MarketplaceChannel): ExportDefinition[] {
  const name = CHANNEL_LABEL[channel]
  const scope = `${channel}:read`

  const SETTLEMENT_TABLES = multi('tables', 'Tables', { payouts: 'Payouts', unsettled: 'Delivered, not settled' }, 'Untick a table to leave it out.')
  const UNMATCHED: ExportFilter = { key: 'unmatched_only', label: 'Only payouts with unmatched lines', kind: 'toggle', default: false }
  const settlements = defineExport({
    key: `${channel}.settlements`,
    title: `${name} settlements`,
    noun: 'Payouts',
    scope,
    columns: [
      { key: 'settled_on', label: 'Settled', type: 'date', id: true },
      { key: 'settlement_ref', label: 'Reference', id: true, width: 1.5 },
      { key: 'period_start', label: 'Period from', type: 'date', optional: true },
      { key: 'period_end', label: 'Period to', type: 'date', optional: true },
      money('gross', 'Sales'),
      money('commission', 'Commission'),
      money('fees', 'Fees'),
      money('tax_withheld', 'TCS / TDS'),
      money('refunds', 'Refunds'),
      money('net_amount', 'Settled'),
      int('lines', 'Lines'),
      int('matched', 'Matched lines'),
      { key: 'source', label: 'Source', optional: true },
      { key: 'file_name', label: 'File', optional: true, width: 1.5 },
    ],
    filters: [SETTLEMENT_TABLES, UNMATCHED],
    scopes: ['filtered'],
    dateRange: { label: 'Settled between' },
    rangeFromQuery,
    period: ctx => {
      const r = settlementRange(ctx)
      return `${r.from} to ${r.to}`
    },
    sections: async ctx => {
      await planGate(scope, name)
      const v = await loadChannelSettlements(channel, settlementRange(ctx))
      const tables = narrowed(SETTLEMENT_TABLES, ctx.filters) ?? ['payouts', 'unsettled']
      const out: ExportSection[] = []
      if (tables.includes('payouts')) {
        const rows = ctx.filters.unmatched_only === true ? v.settlements.filter(s => s.matched < s.lines) : v.settlements
        out.push({
          key: 'payouts',
          title: 'Payouts',
          rows,
          summary: ctx.filters.unmatched_only === true
            ? undefined
            : [
                { label: 'Receivable (delivered, not settled)', value: v.receivable.unsettledValue, type: 'money' },
                { label: 'Unsettled orders', value: v.receivable.unsettledOrders, type: 'int' },
                { label: 'Overdue orders', value: v.receivable.overdueOrders, type: 'int' },
              ],
        })
      }
      if (tables.includes('unsettled'))
        out.push({
          key: 'unsettled',
          title: 'Delivered, not settled',
          columns: [{ key: 'order_number', label: 'Order', id: true }, { key: 'external_order_id', label: `${name} order`, id: true, width: 1.5 }, money('total', 'Value'), { key: 'delivered_at', label: 'Delivered', type: 'datetime' }],
          rows: v.unsettled,
        })
      return out
    },
  })

  const BUCKET_FILTER = multi('buckets', 'Queues', BUCKET_LABEL, 'Untick a queue to leave its orders out.')
  const orders = defineExport({
    key: `${channel}.orders`,
    title: `${name} orders`,
    noun: 'Orders',
    scope,
    columns: [
      { key: 'external_order_id', label: `${name} order`, id: true, width: 1.5 },
      { key: 'order_number', label: 'Our order', id: true },
      { key: 'queue', label: 'Queue' },
      { key: 'status', label: 'Status' },
      { key: 'placed_at', label: 'Placed', type: 'datetime' },
      money('order_total', 'Amount'),
      int('units', 'Units'),
      { key: 'items', label: 'Items', width: 3 },
      { key: 'ship_city', label: 'City' },
      { key: 'ship_state', label: 'State' },
      { key: 'packet_id', label: 'Packet' },
      { key: 'tracking_number', label: 'Tracking', width: 1.4 },
      { key: 'courier', label: 'Courier' },
      { key: 'accept_by', label: 'Accept by', type: 'datetime', optional: true },
      { key: 'dispatch_by', label: 'Dispatch by', type: 'datetime', optional: true },
      { key: 'stock_state', label: 'Stock', optional: true },
      { key: 'stock_note', label: 'Stock note', optional: true, width: 2 },
      { key: 'invoice_number', label: 'Invoice no', optional: true },
      { key: 'po_number', label: 'PO no', optional: true },
      { key: 'manifest_id', label: 'Manifest', optional: true },
      { key: 'raw_status', label: `${name} status`, optional: true },
    ],
    filters: [BUCKET_FILTER],
    scopes: [...ALL_SCOPES],
    describe: ctx => (ctx.query.get('q')?.trim() && ctx.scope === 'filtered' ? [`Search: ${ctx.query.get('q')!.trim()}`] : []),
    sections: async ctx => {
      await planGate(scope, name)
      const buckets = (narrowed(BUCKET_FILTER, ctx.filters) ?? [...QUEUE_BUCKETS]) as QueueBucket[]
      const q = ctx.scope === 'filtered' ? ctx.query.get('q')?.slice(0, 100) : null
      const lists = await Promise.all(buckets.map(async b => (await queueOrders(channel, b, q)).map(o => ({ ...o, queue: BUCKET_LABEL[b] }))))
      const rows = onlyIds(lists.flat(), ctx, o => o.id).map(o => ({ ...o, status: humanize(o.status), order_total: num(o.order_total) }))
      return [{ key: 'orders', rows }]
    },
  })

  const RETURN_STATUS_FILTER = multi('status', 'Return status', RETURN_LABEL)
  const RETURN_TYPE_FILTER = multi('types', 'Type', { customer: 'Customer return', rto: 'RTO (returned to origin)' })
  const returns = defineExport({
    key: `${channel}.returns`,
    title: `${name} returns`,
    noun: 'Returns',
    scope,
    columns: [
      { key: 'external_return_id', label: 'Return', id: true, width: 1.5 },
      { key: 'external_order_id', label: `${name} order`, id: true, width: 1.5 },
      { key: 'order_number', label: 'Our order' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason', width: 2 },
      money('refund_amount', 'Refund'),
      { key: 'tracking_number', label: 'Tracking' },
      { key: 'restocked', label: 'Restocked', type: 'bool' },
      { key: 'created_at', label: 'Raised', type: 'datetime' },
      { key: 'updated_at', label: 'Updated', type: 'datetime', optional: true },
      { key: 'restocked_at', label: 'Restocked at', type: 'datetime', optional: true },
      { key: 'stock_state', label: 'Order stock', optional: true },
    ],
    filters: [RETURN_STATUS_FILTER, RETURN_TYPE_FILTER],
    scopes: [...ALL_SCOPES],
    describe: ctx => [ctx.query.get('scope') === 'all' ? 'All returns' : 'Open returns'],
    sections: async ctx => {
      await planGate(scope, name)
      // The page's Open / All toggle comes in the query; the include choices cut the list further.
      let rows = await listReturns(channel, ctx.query.get('scope') === 'all' ? 'all' : 'open')
      rows = keep(keep(rows, narrowed(RETURN_STATUS_FILTER, ctx.filters), r => r.status), narrowed(RETURN_TYPE_FILTER, ctx.filters), r => r.return_type)
      rows = onlyIds(rows, ctx, r => r.id)
      return [{ key: 'returns', rows: rows.map(r => ({ ...r, type: r.return_type === 'rto' ? 'RTO' : 'Customer return', status: RETURN_LABEL[r.status] ?? r.status, refund_amount: num(r.refund_amount), reason: r.reason ?? '' })) }]
    },
  })

  const STOCK_FILTER = multi('states', 'Rows to include', STOCK_STATE, 'A row with more than one state is kept if any ticked state fits it.')
  const stock = defineExport({
    key: `${channel}.stock`,
    title: `${name} stock`,
    noun: 'Listings',
    scope,
    columns: [
      { key: 'sku', label: 'SKU', id: true },
      { key: 'title', label: 'Product', width: 2 },
      { key: 'listingStatus', label: 'Listing' },
      int('available', 'Your stock'),
      int('reserved', 'Held for orders'),
      int('desired', 'To send'),
      int('pushedQty', 'Sent'),
      { key: 'pushedAt', label: 'Sent at', type: 'datetime' },
      money('ourPrice', 'Our price', { total: undefined }),
      money('listedPrice', `Price on ${name}`, { total: undefined }),
      { key: 'priceDiffers', label: 'Price differs', type: 'bool' },
      { key: 'pushError', label: 'Push error', width: 2 },
    ],
    filters: [STOCK_FILTER],
    scopes: ['filtered'],
    sections: async ctx => {
      await planGate(scope, name)
      const inv = await loadInventory(channel)
      const picked = narrowed(STOCK_FILTER, ctx.filters)
      const states = (r: (typeof inv.rows)[number]) => {
        const s: string[] = []
        if (r.pushError) s.push('error')
        if (r.desired !== r.pushedQty) s.push('pending')
        if (r.ourPrice != null && r.listedPrice != null && Math.abs(r.ourPrice - r.listedPrice) >= 0.01) s.push('drift')
        if (r.pushedAt == null) s.push('never')
        if (!r.pushError && r.desired === r.pushedQty) s.push('synced')
        return s
      }
      const rows = inv.rows.filter(r => !picked || states(r).some(s => picked.includes(s))).map(r => ({ ...r, priceDiffers: states(r).includes('drift'), pushError: r.pushError ?? '' }))
      return [
        {
          key: 'stock',
          rows,
          summary: picked
            ? undefined
            : [
                { label: 'Warehouse', value: inv.warehouse },
                { label: 'Safety buffer', value: inv.buffer, type: 'int' },
                { label: 'Waiting to push', value: inv.totals.pending, type: 'int' },
                { label: 'Push errors', value: inv.totals.errors, type: 'int' },
                { label: 'Price differs', value: inv.totals.drift, type: 'int' },
              ],
        },
      ]
    },
  })

  const LISTING_FILTER = multi('statuses', 'Listing status', LISTING_STATUS)
  const listings = defineExport({
    key: `${channel}.listings`,
    title: `${name} listings`,
    noun: 'Units',
    scope,
    columns: [
      { key: 'ourSku', label: 'Our SKU', id: true },
      { key: 'name', label: 'Product', id: true, width: 2 },
      { key: 'variantName', label: 'Variant' },
      { key: 'subVariantName', label: 'Sub-variant', optional: true },
      { key: 'size', label: 'Size', optional: true },
      { key: 'colour', label: 'Colour', optional: true },
      { key: 'status', label: 'Listing' },
      { key: 'marketplaceSku', label: `${name} SKU`, id: true },
      { key: 'styleId', label: 'Style ID' },
      { key: 'category', label: 'Category', optional: true },
      money('price', 'Our price', { total: undefined }),
      money('mrp', 'MRP', { total: undefined, optional: true }),
      money('listedPrice', `Price on ${name}`, { total: undefined }),
      money('listedMrp', `MRP on ${name}`, { total: undefined, optional: true }),
      { key: 'quantity', label: 'Stock', type: 'int', total: 'sum' },
      { key: 'issues', label: 'Issues', optional: true, width: 2 },
      { key: 'syncedAt', label: 'Synced', type: 'datetime', optional: true },
    ],
    filters: [LISTING_FILTER],
    scopes: ['filtered'],
    describe: ctx => (ctx.query.get('q')?.trim() ? [`Search: ${ctx.query.get('q')!.trim()}`] : []),
    sections: async ctx => {
      await planGate(scope, name)
      const needle = (ctx.query.get('q') ?? '').trim().toLowerCase()
      const views = (await loadSellableUnits(channel)).map(toListingUnitView)
      const status = (u: (typeof views)[number]) => u.listing?.status ?? 'unmapped'
      const rows = keep(views, narrowed(LISTING_FILTER, ctx.filters), status)
        .filter(u => !needle || [u.name, u.variantName, u.subVariantName, u.ourSku, u.listing?.marketplaceSku, u.listing?.styleId].some(v => v?.toLowerCase().includes(needle)))
        .map(u => ({
          ...u,
          variantName: u.variantName ?? '',
          subVariantName: u.subVariantName ?? '',
          status: LISTING_STATUS[status(u)] ?? status(u),
          marketplaceSku: u.listing?.marketplaceSku ?? '',
          styleId: u.listing?.styleId ?? '',
          category: u.listing?.category ?? '',
          listedPrice: u.listing?.listedPrice ?? null,
          listedMrp: u.listing?.listedMrp ?? null,
          issues: list(u.listing?.issues),
          syncedAt: u.listing?.syncedAt ?? null,
        }))
      return [{ key: 'units', rows }]
    },
  })

  return [settlements, orders, returns, stock, listings]
}

// ── Amazon: orders and stock ────────────────────────────────────────────────

const AMAZON_STOCK_STATE: Record<string, string> = { deducted: 'Deducted', restored: 'Restored', short: 'Short on stock', unmatched: 'SKU not matched', none: 'None' }
const AMAZON_FULFIL: Record<string, string> = { AFN: 'Amazon', MFN: 'You' }
const AMAZON_STOCK_FILTER = multi('stock', 'Stock state', AMAZON_STOCK_STATE)
const AMAZON_FULFIL_FILTER = multi('fulfilled_by', 'Fulfilled by', AMAZON_FULFIL)

export const AMAZON_ORDERS_EXPORT = defineExport({
  key: 'amazon.orders',
  title: 'Amazon orders',
  noun: 'Orders',
  scope: 'amazon:read',
  columns: [
    { key: 'amazon_order_id', label: 'Amazon order', id: true, width: 1.6 },
    { key: 'order_number', label: 'Our order', id: true },
    { key: 'purchase_date', label: 'Placed', type: 'datetime' },
    { key: 'status', label: 'Amazon status' },
    { key: 'fulfilled_by', label: 'Fulfilled by' },
    money('order_total', 'Total'),
    { key: 'items', label: 'Items', width: 3 },
    { key: 'ship_city', label: 'City' },
    { key: 'ship_state', label: 'State' },
    { key: 'stock_state', label: 'Stock' },
    { key: 'is_prime', label: 'Prime', type: 'bool', optional: true },
    { key: 'stock_note', label: 'Stock note', optional: true, width: 2 },
  ],
  filters: [AMAZON_STOCK_FILTER, AMAZON_FULFIL_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    await planGate('amazon:read', 'Amazon')
    const { rows: all } = await loadAmazonOrders()
    const rows = keep(keep(all as any[], narrowed(AMAZON_STOCK_FILTER, ctx.filters), r => String(r.stock_state)), narrowed(AMAZON_FULFIL_FILTER, ctx.filters), r => (r.fulfillment_channel === 'AFN' ? 'AFN' : 'MFN')).map(r => ({
      ...r,
      fulfilled_by: AMAZON_FULFIL[r.fulfillment_channel === 'AFN' ? 'AFN' : 'MFN'],
      order_total: num(r.order_total),
      stock_state: AMAZON_STOCK_STATE[r.stock_state] ?? r.stock_state,
      items: ((r.items ?? []) as any[]).map(i => `${i.qty} x ${i.sku ?? i.title}${i.matched ? '' : ' (no match)'}`).join(', '),
    }))
    return [{ key: 'orders', rows }]
  },
})

export const AMAZON_STOCK_EXPORT = defineExport({
  key: 'amazon.stock',
  title: 'Amazon stock',
  noun: 'Listings',
  scope: 'amazon:read',
  columns: [
    { key: 'sku', label: 'SKU', id: true },
    { key: 'title', label: 'Product', width: 2 },
    int('our_available', 'Your stock'),
    int('reserved', 'Held for Amazon'),
    int('pushed_qty', 'Sent to Amazon'),
    int('amazon_quantity', 'Amazon shows'),
    { key: 'pushed_at', label: 'Sent', type: 'datetime' },
    { key: 'push_error', label: 'Push error', width: 2 },
  ],
  filters: [{ key: 'errors_only', label: 'Only rows with a push error', kind: 'toggle', default: false }],
  scopes: ['filtered'],
  sections: async ctx => {
    await planGate('amazon:read', 'Amazon')
    const { rows: all } = await loadAmazonStock()
    const rows = (all as any[]).filter(r => ctx.filters.errors_only !== true || r.push_error).map(r => ({ ...r, title: r.title ?? r.sku, push_error: r.push_error ?? '' }))
    return [{ key: 'stock', rows }]
  },
})

export const OPERATIONS_EXPORTS: ExportDefinition[] = [
  DATA_SOURCE_JOBS_EXPORT,
  DATA_SOURCE_JOB_ROWS_EXPORT,
  DASHBOARD_ACTIVITY_EXPORT,
  DASHBOARD_ANALYTICS_EXPORT,
  TEAM_EXPORT,
  SERVICE_ACCOUNTS_EXPORT,
  DELHIVERY_PICKUPS_EXPORT,
  DELHIVERY_ELIGIBLE_EXPORT,
  SUPPORT_SESSIONS_EXPORT,
  AGENT_PROPOSED_TOOLS_EXPORT,
  INFLATION_HISTORY_EXPORT,
  SHELVING_LOCATIONS_EXPORT,
  ...MARKETPLACE_CHANNELS.flatMap(marketplaceExports),
  AMAZON_ORDERS_EXPORT,
  AMAZON_STOCK_EXPORT,
]
