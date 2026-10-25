import { query, queryMany } from '@/lib/shared/db'
import { disableTokens } from '@/lib/push/devices'
import { pushReady, sendToTokens } from '@/lib/push/send'
import { claimPushSlot, marketingPushOn, pushImage, quietUntil, storefrontPath, writeInbox } from '@/lib/push/marketing'
import { pushCopyProblem, type PushChannel } from '@/lib/push/copy'

// Mailer push: one email_campaign_logs row per app install. Rows start 'queued'; the drain sends
// them, holds a quiet-hours device as 'deferred' until send_after, and ends each row as sent,
// failed or skipped (reason in `error`). The send and the dispatch-mailer cron both drain.

const REACHABLE = `d.disabled_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM notification_preferences p WHERE p.user_id = d.user_id AND p.category = 'offers' AND p.push = false)`
const USER_OK = `u.is_active = true AND u.marketing_opt_out IS NOT TRUE`
const SIGNED_OUT = `d.user_id IS NULL AND d.disabled_at IS NULL AND d.offers_opt_in = true`

/** Audiences that also reach signed-out installs that opted in to offers. */
export const includesSignedOut = (audienceType: string) => audienceType === 'app_installs'

/** Devices a push to these users would reach, plus opted-in signed-out installs when asked. */
export async function pushReach(
  userIds: string[],
  signedOut: boolean
): Promise<{ devices: number; people: number; signedOut: number }> {
  const [r] = await queryMany<{ devices: string; people: string; signed_out: string }>(
    `SELECT
       (SELECT count(*) FROM push_devices d JOIN users u ON u.id = d.user_id AND ${USER_OK}
         WHERE d.user_id = ANY($1::uuid[]) AND ${REACHABLE})::text AS devices,
       (SELECT count(DISTINCT d.user_id) FROM push_devices d JOIN users u ON u.id = d.user_id AND ${USER_OK}
         WHERE d.user_id = ANY($1::uuid[]) AND ${REACHABLE})::text AS people,
       (CASE WHEN $2::boolean THEN (SELECT count(*) FROM push_devices d WHERE ${SIGNED_OUT}) ELSE 0 END)::text AS signed_out`,
    [userIds, signedOut]
  )
  const signedOutN = Number(r?.signed_out ?? 0) || 0
  return { devices: (Number(r?.devices ?? 0) || 0) + signedOutN, people: Number(r?.people ?? 0) || 0, signedOut: signedOutN }
}

/** One 'queued' log row per reachable install; idempotent per campaign and device. */
export async function enqueueCampaignPush(campaignId: string, userIds: string[], signedOut: boolean): Promise<number> {
  const r = await query(
    `INSERT INTO email_campaign_logs (campaign_id, channel, push_device_id, user_id, to_address, status)
     SELECT $1, 'push', d.id, d.user_id, left(COALESCE(u.email, u.phone), 255), 'queued'
       FROM push_devices d JOIN users u ON u.id = d.user_id AND ${USER_OK}
      WHERE d.user_id = ANY($2::uuid[]) AND ${REACHABLE}
     UNION ALL
     SELECT $1, 'push', d.id, NULL, NULL, 'queued' FROM push_devices d WHERE $3::boolean AND ${SIGNED_OUT}
     ON CONFLICT (campaign_id, push_device_id) WHERE push_device_id IS NOT NULL DO NOTHING`,
    [campaignId, userIds, signedOut]
  )
  return r.rowCount ?? 0
}

interface Claimed {
  id: string
  campaign_id: string
  push_device_id: string | null
  user_id: string | null
}
interface Device {
  id: string
  token: string
  user_id: string | null
  timezone: string | null
  disabled: boolean
  offers_opt_in: boolean
  is_active: boolean | null
  marketing_opt_out: boolean | null
  offers_push: boolean | null
  email: string | null
  first_name: string | null
  last_name: string | null
}
type Outcome = { status: 'sent' | 'failed' | 'skipped' | 'deferred'; error?: string | null; sendAfter?: Date | null }
export type DrainTotals = Record<Outcome['status'], number>

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    })
  )
}

const BATCH = 500

/** Send due Mailer push rows (one campaign, or every campaign from the cron) within a time budget. */
export async function drainCampaignPush(opts: { campaignId?: string; budgetMs?: number } = {}): Promise<DrainTotals> {
  const totals: DrainTotals = { sent: 0, failed: 0, skipped: 0, deferred: 0 }
  const deadline = Date.now() + (opts.budgetMs ?? 45_000)
  const { createTemplateVariableResolver } = await import('@/lib/templates/variables')
  const { renderCampaignTemplate } = await import('@/lib/shared/automation-emails')
  const resolveVars = await createTemplateVariableResolver()
  const flagOn = await marketingPushOn()
  const ready = pushReady()

  // A batch whose process died mid-send is closed out, not retried (it may have been delivered).
  await query(
    `UPDATE email_campaign_logs SET status = 'failed', error = 'interrupted'
      WHERE channel = 'push' AND status = 'sending' AND sent_at < now() - interval '15 minutes'`
  )

  while (Date.now() < deadline) {
    const rows = await queryMany<Claimed>(
      `UPDATE email_campaign_logs l SET status = 'sending', sent_at = now()
        WHERE l.id IN (
          SELECT id FROM email_campaign_logs
           WHERE channel = 'push' AND status IN ('queued', 'deferred') AND (send_after IS NULL OR send_after <= now())
             AND ($1::uuid IS NULL OR campaign_id = $1)
           ORDER BY send_after NULLS FIRST
           LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED)
        RETURNING l.id, l.campaign_id, l.push_device_id, l.user_id`,
      [opts.campaignId ?? null]
    )
    if (!rows.length) break

    const deviceIds = [...new Set(rows.map(r => r.push_device_id).filter((x): x is string => !!x))]
    const [devices, campaigns] = await Promise.all([
      queryMany<Device>(
        `SELECT d.id, d.token, d.user_id, d.timezone, d.disabled_at IS NOT NULL AS disabled, d.offers_opt_in,
                u.is_active, u.marketing_opt_out, p.push AS offers_push, u.email, u.first_name, u.last_name
           FROM push_devices d
           LEFT JOIN users u ON u.id = d.user_id
           LEFT JOIN notification_preferences p ON p.user_id = d.user_id AND p.category = 'offers'
          WHERE d.id = ANY($1::uuid[])`,
        [deviceIds]
      ),
      queryMany<{ id: string; push: PushChannel | null }>(`SELECT id, channels->'push' AS push FROM email_campaigns WHERE id = ANY($1::uuid[])`, [
        [...new Set(rows.map(r => r.campaign_id))],
      ]),
    ])
    const byDevice = new Map(devices.map(d => [d.id, d]))
    const byCampaign = new Map(campaigns.map(c => [c.id, c.push]))

    const outcome = new Map<string, Outcome>()
    const set = (ids: string[], o: Outcome) => ids.forEach(id => outcome.set(id, o))
    // campaign|person → the rows (devices) to send now.
    const groups = new Map<string, { campaignId: string; userId: string | null; rows: Array<{ row: Claimed; dev: Device }> }>()

    for (const row of rows) {
      const copy = byCampaign.get(row.campaign_id)
      const dev = row.push_device_id ? byDevice.get(row.push_device_id) : undefined
      const problem = pushCopyProblem(copy)
      if (problem) set([row.id], { status: 'skipped', error: problem })
      else if (!dev) set([row.id], { status: 'skipped', error: 'device_removed' })
      else if (dev.disabled) set([row.id], { status: 'skipped', error: 'device_disabled' })
      else if ((dev.user_id ?? null) !== (row.user_id ?? null)) set([row.id], { status: 'skipped', error: dev.user_id ? 'device_signed_in' : 'device_signed_out' })
      else if (row.user_id ? !dev.is_active || dev.marketing_opt_out || dev.offers_push === false : !dev.offers_opt_in)
        set([row.id], { status: 'skipped', error: 'opted_out' })
      else {
        const key = `${row.campaign_id}|${row.user_id ?? `d:${dev.id}`}`
        const g = groups.get(key) ?? { campaignId: row.campaign_id, userId: row.user_id, rows: [] }
        g.rows.push({ row, dev })
        groups.set(key, g)
      }
    }

    const dead: string[] = []
    const record = (list: Array<{ row: Claimed; dev: Device }>, results: Awaited<ReturnType<typeof sendToTokens>>) => {
      const byToken = new Map(results.map(r => [r.token, r]))
      for (const x of list) {
        const r = byToken.get(x.dev.token)
        if (r?.invalidToken) dead.push(x.dev.token)
        set([x.row.id], r?.ok ? { status: 'sent' } : { status: 'failed', error: r?.error ?? 'not sent' })
      }
    }
    // Signed-out installs of a campaign share one payload, so their tokens go out together.
    const signedOutBatches = new Map<string, Array<{ row: Claimed; dev: Device }>>()

    type Group = { campaignId: string; userId: string | null; rows: Array<{ row: Claimed; dev: Device }> }
    const sendGroup = async (g: Group): Promise<void> => {
      const copy = byCampaign.get(g.campaignId)!
      const first = g.rows[0].dev
      const registered = resolveVars({
        recipient: { email: first.email ?? '', first_name: first.first_name, last_name: first.last_name },
      })
      const render = (t: string) => renderCampaignTemplate(t, { firstName: (g.userId && first.first_name) || 'there' }, registered, false).trim()
      const title = render(copy.title)
      const body = render(copy.body)
      const link = storefrontPath(copy.link)
      const image = pushImage(copy.image_url)
      let notificationId: string | null = null
      if (g.userId) {
        notificationId = await writeInbox(
          g.userId,
          { category: 'offers', type: 'campaign', title, body, link, image, source: 'campaign', sourceRef: g.campaignId },
          true
        ).catch(() => null)
      }
      if (!flagOn) return set(g.rows.map(x => x.row.id), { status: 'skipped', error: 'push_disabled' })
      if (!ready) return set(g.rows.map(x => x.row.id), { status: 'failed', error: 'push is not configured' })

      const now: typeof g.rows = []
      for (const x of g.rows) {
        const until = quietUntil(x.dev.timezone)
        if (until) set([x.row.id], { status: 'deferred', error: 'quiet_hours', sendAfter: until })
        else now.push(x)
      }
      if (!now.length) return
      const target = g.userId ? { userId: g.userId } : { userId: null, deviceId: now[0].dev.id }
      if (!(await claimPushSlot(target, 'campaign', g.campaignId).catch(() => false))) {
        return set(now.map(x => x.row.id), { status: 'skipped', error: 'frequency_cap' })
      }
      if (!g.userId) {
        const list = signedOutBatches.get(g.campaignId) ?? []
        list.push(...now)
        signedOutBatches.set(g.campaignId, list)
        return
      }
      const results = await sendToTokens(
        now.map(x => x.dev.token),
        {
          title, body, link, image, category: 'offers',
          collapseKey: `mailer-${g.campaignId}`,
          data: { campaign_id: g.campaignId, ...(notificationId ? { notification_id: notificationId } : {}) },
          reference: `mailer:${g.campaignId}`,
        }
      )
      record(now, results)
    }
    await pool([...groups.values()], 8, g =>
      sendGroup(g).catch(e => set(g.rows.map(x => x.row.id), { status: 'failed', error: String(e?.message ?? e) }))
    )

    for (const [campaignId, list] of signedOutBatches) {
      const copy = byCampaign.get(campaignId)!
      const registered = resolveVars({ recipient: { email: '' } })
      const render = (t: string) => renderCampaignTemplate(t, { firstName: 'there' }, registered, false).trim()
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH)
        const results = await sendToTokens(
          chunk.map(x => x.dev.token),
          {
            title: render(copy.title), body: render(copy.body), link: storefrontPath(copy.link), image: pushImage(copy.image_url),
            category: 'offers', collapseKey: `mailer-${campaignId}`, data: { campaign_id: campaignId }, reference: `mailer:${campaignId}`,
          }
        )
        record(chunk, results)
      }
    }

    if (dead.length) await disableTokens(dead, 'fcm_invalid').catch(() => {})

    // Anything left undecided by an unexpected error is closed out rather than left 'sending'.
    for (const row of rows) if (!outcome.has(row.id)) outcome.set(row.id, { status: 'failed', error: 'send error' })
    const byStatus = new Map<string, { ids: string[]; o: Outcome }>()
    for (const [id, o] of outcome) {
      const k = `${o.status}|${o.error ?? ''}|${o.sendAfter?.toISOString() ?? ''}`
      const b = byStatus.get(k) ?? { ids: [], o }
      b.ids.push(id)
      byStatus.set(k, b)
      totals[o.status]++
    }
    for (const { ids, o } of byStatus.values()) {
      await query(
        `UPDATE email_campaign_logs SET status = $2::text, error = $3, send_after = $4,
                sent_at = CASE WHEN $2::text = 'deferred' THEN sent_at ELSE now() END
          WHERE id = ANY($1::uuid[])`,
        [ids, o.status, o.error?.slice(0, 1000) ?? null, o.sendAfter ?? null]
      )
    }
  }
  return totals
}

export interface CampaignPushReport {
  sent: number
  failed: number
  skipped: number
  capped: number
  waiting: number
  signedOut: number
  opened: number
  converted: number
}

/**
 * A Mailer campaign's push outcome. Sent/failed/skipped count installs; opened and converted count
 * signed-in people (inbox taps; an order within 24 hours of the tap). Signed-out taps can't be tied to anyone.
 */
export async function campaignPushReport(campaignId: string): Promise<CampaignPushReport | null> {
  const { realized } = await import('@/lib/overviews/marketing')
  const [r] = await queryMany<Record<string, string>>(
    `SELECT
       count(*) FILTER (WHERE l.status = 'sent')::text AS sent,
       count(*) FILTER (WHERE l.status = 'failed')::text AS failed,
       count(*) FILTER (WHERE l.status = 'skipped')::text AS skipped,
       count(*) FILTER (WHERE l.status = 'skipped' AND l.error = 'frequency_cap')::text AS capped,
       count(*) FILTER (WHERE l.status IN ('queued', 'deferred', 'sending'))::text AS waiting,
       count(*) FILTER (WHERE l.user_id IS NULL)::text AS signed_out,
       count(*)::text AS total,
       (SELECT count(*) FROM notifications n WHERE n.source = 'campaign' AND n.source_ref = $2 AND n.opened_at IS NOT NULL)::text AS opened,
       (SELECT count(*) FROM notifications n
         WHERE n.source = 'campaign' AND n.source_ref = $2 AND n.opened_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id = n.user_id AND ${realized('o')}
                        AND o.created_at >= n.opened_at AND o.created_at < n.opened_at + interval '24 hours'))::text AS converted
     FROM email_campaign_logs l WHERE l.campaign_id = $1 AND l.channel = 'push'`,
    [campaignId, campaignId]
  )
  if (!r || !Number(r.total)) return null
  const n = (k: string) => Number(r[k] ?? 0) || 0
  return {
    sent: n('sent'),
    failed: n('failed'),
    skipped: n('skipped'),
    capped: n('capped'),
    waiting: n('waiting'),
    signedOut: n('signed_out'),
    opened: n('opened'),
    converted: n('converted'),
  }
}
