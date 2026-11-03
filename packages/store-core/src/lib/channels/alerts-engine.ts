import { z } from 'zod'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { escapeHtml, mailShell } from '@/lib/shared/mail-template'
import { adsRecipients as scopedRecipients, flag, readSetting, writeSettings } from '@/lib/google-ads/notify'
import { CHANNEL_INFO, type Channel, type Severity } from './types'

// The Google Ads alert machinery for every other channel: each channel defines its rules (a zod
// config per rule with defaults, a snapshot loader and a pure evaluate), and this engine stores
// findings in channel_alerts keyed by (channel, dedupe_key), resolves cleared ones, and sends one
// bell notification and one email per batch, skipping keys notified in the last 24 hours.

export interface Finding {
  rule: string
  key: string
  severity: Severity
  title: string
  message: string
  entityType?: string
  entityId?: string
  data?: Record<string, unknown>
}

export interface RuleSet<Cfg extends Record<string, { enabled: boolean }>, Snap> {
  channel: Channel
  schema: z.ZodObject<{ [K in keyof Cfg]: z.ZodType<Cfg[K]> }>
  defaults: Cfg
  labels: Record<keyof Cfg & string, string>
  loadSnapshot: (cfg: Cfg, now: Date) => Promise<Snap>
  evaluate: (snap: Snap, cfg: Cfg) => Finding[]
}

const settingKey = (c: Channel, k: 'rules' | 'emails') => `${c}_alert_${k}`

export function mergeRuleConfig<Cfg extends Record<string, { enabled: boolean }>>(
  rs: Pick<RuleSet<Cfg, unknown>, 'schema' | 'defaults'>,
  raw: string | null
): Cfg {
  let stored: Record<string, unknown> = {}
  try {
    stored = raw ? JSON.parse(raw) : {}
  } catch {
    stored = {}
  }
  const out = { ...rs.defaults } as Record<string, unknown>
  for (const rule of Object.keys(rs.defaults)) {
    const merged = { ...(rs.defaults as any)[rule], ...((stored[rule] as object) ?? {}) }
    const ok = (rs.schema.shape as any)[rule].safeParse(merged)
    if (ok.success) out[rule] = ok.data
  }
  return out as Cfg
}

export async function getRuleConfig<Cfg extends Record<string, { enabled: boolean }>>(rs: RuleSet<Cfg, any>): Promise<Cfg> {
  return mergeRuleConfig(rs, await readSetting(settingKey(rs.channel, 'rules')))
}

export async function getAlertEmails(channel: Channel): Promise<boolean> {
  return flag(await readSetting(settingKey(channel, 'emails')), true)
}

export async function saveRuleSettings(channel: Channel, cfg: unknown, emails: boolean): Promise<void> {
  await writeSettings({ [settingKey(channel, 'rules')]: JSON.stringify(cfg), [settingKey(channel, 'emails')]: String(emails) })
}

export interface ChannelAlertRow {
  id: string
  rule: string
  dedupe_key: string
  severity: Severity
  title: string
  message: string | null
  entity_type: string | null
  entity_id: string | null
  status: 'open' | 'dismissed' | 'resolved'
  first_seen_at: string
  last_seen_at: string
  notified_at: string | null
}

const COLS = `id::text, rule, dedupe_key, severity, title, message, entity_type, entity_id, status, first_seen_at, last_seen_at, notified_at`

export async function applyFindings(channel: Channel, findings: Finding[]): Promise<{ created: ChannelAlertRow[]; resolved: number }> {
  const created: ChannelAlertRow[] = []
  const seen = new Set<string>()
  for (const f of findings) {
    if (seen.has(f.key)) continue
    seen.add(f.key)
    const updated = await queryOne<{ id: string }>(
      `UPDATE channel_alerts SET last_seen_at = now(), title = $3, message = $4, severity = $5, data = $6::jsonb
       WHERE channel = $1 AND dedupe_key = $2 AND status IN ('open', 'dismissed') RETURNING id`,
      [channel, f.key, f.title, f.message, f.severity, JSON.stringify(f.data ?? {})]
    )
    if (updated) continue
    const row = await queryOne<ChannelAlertRow>(
      `INSERT INTO channel_alerts (channel, rule, dedupe_key, severity, title, message, entity_type, entity_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (channel, dedupe_key) WHERE status IN ('open', 'dismissed') DO NOTHING
       RETURNING ${COLS}`,
      [channel, f.rule, f.key, f.severity, f.title, f.message, f.entityType ?? null, f.entityId ?? null, JSON.stringify(f.data ?? {})]
    )
    if (row) created.push(row)
  }
  const res = await query(
    `UPDATE channel_alerts SET status = 'resolved', resolved_at = now()
     WHERE channel = $1 AND status IN ('open', 'dismissed') AND NOT (dedupe_key = ANY($2::text[]))`,
    [channel, [...seen]]
  )
  return { created, resolved: res.rowCount ?? 0 }
}

export async function alertsToNotify(channel: Channel, created: ChannelAlertRow[]): Promise<ChannelAlertRow[]> {
  if (!created.length) return []
  const recent = await queryMany<{ dedupe_key: string }>(
    `SELECT DISTINCT dedupe_key FROM channel_alerts
     WHERE channel = $1 AND dedupe_key = ANY($2::text[]) AND notified_at > now() - interval '24 hours' AND NOT (id = ANY($3::bigint[]))`,
    [channel, created.map(c => c.dedupe_key), created.map(c => c.id)]
  ).catch(() => [])
  const skip = new Set(recent.map(r => r.dedupe_key))
  return created.filter(c => !skip.has(c.dedupe_key))
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

export function renderChannelAlertsEmail(
  channel: Channel,
  alerts: Pick<ChannelAlertRow, 'title' | 'message' | 'severity'>[],
  brand: string,
  url: string
): { subject: string; html: string } {
  const label = CHANNEL_INFO[channel].label
  const subject = alerts.length === 1 ? `${label} alert: ${alerts[0].title}` : `${alerts.length} new ${label} alerts`
  const rows = alerts
    .map(
      a => `<tr><td style="width:70px;color:${a.severity === 'critical' ? '#dc2626' : a.severity === 'warning' ? '#d97706' : '#2563eb'};font-weight:600;">${escapeHtml(a.severity)}</td>
        <td><strong>${escapeHtml(a.title)}</strong>${a.message ? `<br><span class="muted">${escapeHtml(a.message)}</span>` : ''}</td></tr>`
    )
    .join('')
  const html = mailShell({
    brand,
    kicker: `${label} alerts`,
    title: subject,
    documentTitle: subject,
    content: `<table class="rows">${rows}</table>
      <div class="cta"><a class="button" href="${escapeHtml(url)}">Open ${escapeHtml(label)}</a></div>
      <p class="muted">You get these because you can see ${escapeHtml(label)} in the store admin. Turn alert emails off on its Alerts tab.</p>`,
  })
  return { subject, html }
}

export async function channelConsoleUrl(channel: Channel, tab?: string): Promise<string> {
  const { currentAdminBaseUrlAsync } = await import('@/lib/catalog/brand')
  const base = (await currentAdminBaseUrlAsync()).replace(/\/admin\/?$/, '').replace(/\/$/, '')
  return `${base}${CHANNEL_INFO[channel].path}${tab ? `?tab=${tab}` : ''}`
}

export async function notifyChannelAlerts(channel: Channel, alerts: ChannelAlertRow[]): Promise<{ bell: boolean; emailed: number }> {
  if (!alerts.length) return { bell: false, emailed: 0 }
  const info = CHANNEL_INFO[channel]
  const top = alerts.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a))
  await createAdminNotification({
    type: `${channel}_alert`,
    category: 'marketing',
    severity: top.severity,
    title: alerts.length === 1 ? `${info.label}: ${top.title}` : `${alerts.length} new ${info.label} alerts`,
    message: alerts.map(a => a.title).slice(0, 5).join(' · '),
    link: `/admin${info.path}?tab=alerts`,
    entityType: 'channel_alert',
    entityId: `batch-${alerts[0].id}`,
    scope: info.readScope,
  })
  let emailed = 0
  if (await getAlertEmails(channel)) {
    const { currentBrandNameAsync } = await import('@/lib/catalog/brand')
    const { briefingFromAsync } = await import('@/lib/shared/daily-briefing')
    const { subject, html } = renderChannelAlertsEmail(channel, alerts, await currentBrandNameAsync(), await channelConsoleUrl(channel, 'alerts'))
    const from = await briefingFromAsync()
    for (const to of await scopedRecipients(info.readScope)) {
      try {
        await sendAuditedMail({ from, to, subject, html, kind: `${channel}_alert`, entityType: 'channel_alert', entityId: alerts[0].id })
        emailed++
      } catch (e) {
        console.error(`[${channel}] alert email failed`, e)
      }
    }
  }
  await query(`UPDATE channel_alerts SET notified_at = now() WHERE id = ANY($1::bigint[])`, [alerts.map(a => a.id)])
  return { bell: true, emailed }
}

export interface AlertRunResult {
  findings: number
  created: number
  resolved: number
  notified: number
}

/** Evaluate, store and notify. Never throws: alerts must not fail the job that ran them. */
export async function runChannelAlerts<Cfg extends Record<string, { enabled: boolean }>, Snap>(
  rs: RuleSet<Cfg, Snap>,
  now = new Date()
): Promise<AlertRunResult | { error: string }> {
  try {
    const cfg = await getRuleConfig(rs)
    const findings = rs.evaluate(await rs.loadSnapshot(cfg, now), cfg)
    const { created, resolved } = await applyFindings(rs.channel, findings)
    const toNotify = await alertsToNotify(rs.channel, created)
    await notifyChannelAlerts(rs.channel, toNotify)
    return { findings: findings.length, created: created.length, resolved, notified: toNotify.length }
  } catch (e: any) {
    console.error(`[${rs.channel}] alerts failed`, e)
    return { error: String(e?.message ?? e).slice(0, 300) }
  }
}

export async function listChannelAlerts(channel: Channel): Promise<ChannelAlertRow[]> {
  return queryMany<ChannelAlertRow>(
    `SELECT ${COLS} FROM channel_alerts WHERE channel = $1 AND status IN ('open', 'dismissed')
     ORDER BY (status = 'open') DESC, CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 100`,
    [channel]
  ).catch(() => [])
}

export async function dismissChannelAlert(channel: Channel, id: string, by: string | null): Promise<boolean> {
  const r = await query(
    `UPDATE channel_alerts SET status = 'dismissed', dismissed_at = now(), dismissed_by = $3
     WHERE channel = $1 AND id = $2::bigint AND status = 'open'`,
    [channel, id, by]
  )
  return (r.rowCount ?? 0) > 0
}
