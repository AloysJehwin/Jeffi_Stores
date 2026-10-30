import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantPlan } from '@/lib/auth/plan-gate'
import { currentAdminBaseUrlAsync, currentBrandNameAsync } from '@/lib/catalog/brand'
import { collectBriefingData, narrate, renderBriefingEmail, type BriefingData } from '@/lib/shared/daily-briefing'
import { buildOpsAttachments, wantedDocs, type OpsAttachments } from '@/lib/shared/ops-email-attachments'
import { OPS_EMAIL_KEY, readOpsEmail, sectionAvailable, sectionOn, type OpsEmailConfig } from '@/lib/shared/ops-email-config'

// The daily ops email for the current store: its settings, what its plan allows, the email itself and
// who it goes to. Shared by the cron, the Site Controls preview and its test send.

export interface OpsEmailContext {
  cfg: OpsEmailConfig
  /** A scope the store's plan includes (the platform's own store has every one). */
  planHas: (scope: string) => boolean
}

export async function loadOpsEmail(): Promise<OpsEmailContext> {
  const tenantId = await resolveTenantId().catch(() => null)
  const scopes = tenantId ? (await getTenantPlan(tenantId)).scopes : null
  const planHas = (scope: string) => !scopes || scopes.has(scope)
  const row = await queryOne<{ value: string }>(`SELECT value FROM site_settings WHERE key = $1`, [OPS_EMAIL_KEY])
  // A store that never saved its settings keeps the original briefing: on with the AI assistant's plans.
  return { cfg: readOpsEmail(row?.value, planHas('agent:read')), planHas }
}

/** Sections the plan doesn't include are switched off. */
export function effectiveConfig(cfg: OpsEmailConfig, planHas: (scope: string) => boolean): OpsEmailConfig {
  return { ...cfg, sections: cfg.sections.map(s => (s.on && !sectionAvailable(s.id, planHas) ? { ...s, on: false } : s)) }
}

export interface BuiltOpsEmail {
  subject: string
  html: string
  data: BriefingData
  narration: string
  attachments: OpsAttachments['attachments']
  note: string
}

export async function buildOpsEmail(
  ctx: OpsEmailContext,
  opts: { ai: boolean | 'placeholder'; attachments: boolean | 'summary' }
): Promise<BuiltOpsEmail> {
  const cfg = effectiveConfig(ctx.cfg, ctx.planHas)
  const data = await collectBriefingData(cfg)
  const narration = !sectionOn(cfg, 'ai_headline')
    ? ''
    : opts.ai === 'placeholder'
      ? 'The AI headline goes here: two or three sentences on what matters most today.'
      : opts.ai
        ? await narrate(data)
        : ''
  const [brand, adminBase] = await Promise.all([currentBrandNameAsync(), currentAdminBaseUrlAsync()])
  const adminUrl = adminBase.replace(/\/admin\/?$/, '').replace(/\/$/, '')
  const ids = data.to_ship?.orders.map(o => o.id) ?? []
  let built: OpsAttachments = { attachments: [], note: '' }
  if (opts.attachments === 'summary') built = { attachments: [], note: attachmentSummary(cfg, ctx.planHas, ids.length) }
  else if (opts.attachments) built = await buildOpsAttachments(cfg, ids, ctx.planHas, `${adminUrl}/packing-slips`)
  const { subject, html } = renderBriefingEmail(data, narration, { cfg, brand, adminUrl, attachmentNote: built.note })
  return { subject, html, data, narration, attachments: built.attachments, note: built.note }
}

const DOC_NAMES = { invoice: 'invoices', packing_slip: 'packing slips', label: 'shipping labels' } as const

function attachmentSummary(cfg: OpsEmailConfig, planHas: (scope: string) => boolean, orders: number): string {
  const docs = wantedDocs(cfg, planHas)
  if (!docs.length) return ''
  if (!orders) return 'No orders waiting to ship right now, so nothing would be attached.'
  const names = docs.map(d => DOC_NAMES[d])
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return `Will attach one PDF of ${list} for the ${orders} order${orders === 1 ? '' : 's'} waiting to ship${docs.includes('label') ? ' (labels only for booked shipments)' : ''}.`
}

/** Active admins chosen in the settings, plus the extra addresses; lower-cased and de-duplicated. */
export async function opsEmailRecipients(cfg: OpsEmailConfig): Promise<string[]> {
  const admins = await queryMany<{ id: string; role: string; email: string | null }>(
    `SELECT a.id::text, a.role, u.email FROM admins a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.is_active = TRUE AND u.email IS NOT NULL`,
    []
  )
  const r = cfg.recipients
  const chosen = admins.filter(a => (r.mode === 'all' ? true : r.mode === 'roles' ? r.roles.includes(a.role) : r.adminIds.includes(a.id)))
  const emails = [...chosen.map(a => a.email ?? ''), ...r.extra].map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
  return [...new Set(emails)]
}
