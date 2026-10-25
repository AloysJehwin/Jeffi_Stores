import { query, queryMany, queryOne } from '@/lib/shared/db'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { alreadySentForReference, canSendMarketing, recordSent, type CampaignKind } from '@/lib/shared/marketing'
import { days } from '@/lib/campaigns/duration'
import { campaignMessageRenderer, type CampaignWaVars } from '@/lib/campaigns/whatsapp-dispatch'
import { campaignSupportsPush, pushCategoryFor, scenarioPushCopy } from '@/lib/campaigns/push-kinds'
import { pushAllowed, type NotificationCategory } from '@/lib/push/preferences'
import { disableTokens } from '@/lib/push/devices'
import { pushReady, sendToTokens } from '@/lib/push/send'
import { claimPushSlot, marketingPushOn, pushImage, quietUntil, storefrontPath, writeInbox } from '@/lib/push/marketing'

// Campaign → app push, beside sendCampaignWhatsApp. Fire-and-forget from a scenario's send() when
// params.pushEnabled is true. Dedup marker `push:<kind>` on email_campaigns_sent (metadata.status:
// sent | deferred | skipped | failed), an inbox row (source 'scenario', source_ref <kind>), quiet
// hours per device (held in push_queue) and the shared daily cap. Never throws.

export type CampaignPushResult = { ok: boolean; reason?: string }

interface Device {
  id: string
  token: string
  timezone: string | null
}

interface Notice {
  userId: string
  kind: string
  category: NotificationCategory
  notificationId: string
  title: string
  body: string
  link: string
  image?: string
}

const markerStatus = (sentId: string | null, status: string, reason?: string) =>
  sentId
    ? query(
        `UPDATE email_campaigns_sent SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('status', $2::text, 'reason', $3::text) WHERE id = $1`,
        [sentId, status, reason ?? null]
      ).catch(() => {})
    : Promise.resolve()

async function sendNow(n: Notice, devices: Device[]): Promise<{ status: 'sent' | 'failed' | 'skipped'; reason?: string }> {
  if (!(await claimPushSlot({ userId: n.userId }, 'scenario', n.notificationId).catch(() => false))) {
    return { status: 'skipped', reason: 'frequency_cap' }
  }
  const results = await sendToTokens(
    devices.map(d => d.token),
    {
      title: n.title,
      body: n.body,
      link: n.link,
      image: n.image,
      category: n.category,
      collapseKey: `scenario-${n.kind}`.slice(0, 64),
      data: { notification_id: n.notificationId },
      reference: `campaign:${n.kind}`,
    }
  )
  const dead = results.filter(r => r.invalidToken).map(r => r.token)
  if (dead.length) await disableTokens(dead, 'fcm_invalid').catch(() => {})
  return results.some(r => r.ok) ? { status: 'sent' } : { status: 'failed', reason: results.find(r => r.error)?.error ?? 'not sent' }
}

export async function sendCampaignPush(
  kind: string,
  userId: string,
  vars: CampaignWaVars,
  // Per-user cooldown (MINUTES) for the push:<kind> marker, like sendCampaignWhatsApp.
  cooldownMin?: number | null
): Promise<CampaignPushResult> {
  try {
    const row = await queryOne<{ parameters: Record<string, unknown> | null; scenario_kind: string | null }>(
      `SELECT parameters, scenario_kind FROM campaigns WHERE kind = $1`,
      [kind]
    )
    // A copy of a built-in campaign runs the built-in scenario under its own kind.
    const base = campaignSupportsPush(kind) ? kind : (row?.scenario_kind ?? '')
    if (!campaignSupportsPush(base)) return { ok: false, reason: 'unsupported_kind' }
    const params = row?.parameters ?? {}
    if (params.pushEnabled !== true) return { ok: false, reason: 'push_off' }

    const gate = await canSendMarketing(userId, kind as CampaignKind, { phoneChannel: true })
    if (!gate.ok) return { ok: false, reason: gate.reason || 'opted_out' }
    const category = pushCategoryFor(base)
    if (!(await pushAllowed(userId, category))) return { ok: false, reason: 'push_muted' }
    const devices = await queryMany<Device>(
      `SELECT id, token, timezone FROM push_devices WHERE user_id = $1 AND disabled_at IS NULL ORDER BY last_seen_at DESC LIMIT 20`,
      [userId]
    )
    if (!devices.length) return { ok: false, reason: 'no_device' }

    const ref = `push:${kind}`
    const window = typeof cooldownMin === 'number' && cooldownMin > 0 ? cooldownMin : days(1)
    if (await alreadySentForReference(kind as CampaignKind, userId, ref, window)) return { ok: false, reason: 'cooldown' }
    // Claimed before sending, as WhatsApp does, so a crash mid-send can't cause a resend storm.
    const sentId = await recordSent({ campaignKind: kind as CampaignKind, userId, referenceId: ref, channel: 'push', metadata: { status: 'pending' } })

    const user = await queryOne<{ email: string | null; first_name: string | null; last_name: string | null }>(
      `SELECT email, first_name, last_name FROM users WHERE id = $1`,
      [userId]
    )
    const { render } = await campaignMessageRenderer(vars, user ?? { email: null, first_name: null, last_name: null })
    const copy = scenarioPushCopy(base, params)
    const title = render(copy.title)
    const body = render(copy.body)
    const link = storefrontPath(copy.link ? render(copy.link) : vars.url, await storeBaseUrlAsync().catch(() => null))
    const image = pushImage(vars.imageUrl)
    const notificationId = await writeInbox(userId, { category, type: `scenario_${kind}`.slice(0, 50), title, body, link, image, source: 'scenario', sourceRef: kind })
    if (!notificationId) {
      await markerStatus(sentId, 'failed', 'inbox write failed')
      return { ok: false, reason: 'inbox_failed' }
    }

    if (!(await marketingPushOn())) {
      await markerStatus(sentId, 'skipped', 'push_disabled')
      return { ok: false, reason: 'push_disabled' }
    }
    if (!pushReady()) {
      await markerStatus(sentId, 'failed', 'push is not configured')
      return { ok: false, reason: 'not_configured' }
    }

    const now: Device[] = []
    const held: Array<{ d: Device; until: Date }> = []
    for (const d of devices) {
      const until = quietUntil(d.timezone)
      if (until) held.push({ d, until })
      else now.push(d)
    }
    for (const h of held) {
      await query(
        `INSERT INTO push_queue (notification_id, push_device_id, send_after) VALUES ($1, $2, $3) ON CONFLICT (notification_id, push_device_id) DO NOTHING`,
        [notificationId, h.d.id, h.until]
      )
    }
    const n: Notice = { userId, kind, category, notificationId, title, body, link, image }
    const r = now.length ? await sendNow(n, now) : { status: 'deferred' as const, reason: 'quiet_hours' }
    await markerStatus(sentId, r.status, r.reason)
    if (r.status !== 'sent' && r.status !== 'deferred') console.warn(`[campaign-push] ${kind} user=${userId} ${r.status}: ${r.reason ?? ''}`)
    return { ok: r.status === 'sent' || r.status === 'deferred', reason: r.reason }
  } catch (e) {
    console.error(`[campaign-push] ${kind} user=${userId} error:`, e)
    return { ok: false, reason: 'error' }
  }
}

/** Scenario pushes held for quiet hours whose window has ended (the dispatch-mailer cron). */
export async function drainScenarioPushQueue(budgetMs = 20_000): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 }
  const deadline = Date.now() + budgetMs
  const flagOn = await marketingPushOn()
  while (Date.now() < deadline) {
    const due = await queryMany<{ notification_id: string; push_device_id: string }>(
      `DELETE FROM push_queue WHERE id IN (
         SELECT id FROM push_queue WHERE send_after <= now() ORDER BY send_after LIMIT 500 FOR UPDATE SKIP LOCKED)
       RETURNING notification_id, push_device_id`
    )
    if (!due.length) break
    const rows = await queryMany<{
      notification_id: string
      user_id: string
      title: string
      body: string | null
      link: string | null
      image_url: string | null
      category: NotificationCategory | null
      kind: string
      device_id: string
      token: string
      timezone: string | null
      device_user: string | null
      disabled: boolean
    }>(
      `SELECT n.id AS notification_id, n.user_id, n.title, n.message AS body, n.link, n.image_url, n.category, n.source_ref AS kind,
              d.id AS device_id, d.token, d.timezone, d.user_id AS device_user, d.disabled_at IS NOT NULL AS disabled
         FROM unnest($1::uuid[], $2::uuid[]) q(nid, did)
         JOIN notifications n ON n.id = q.nid
         JOIN push_devices d ON d.id = q.did`,
      [due.map(d => d.notification_id), due.map(d => d.push_device_id)]
    )
    const byNotice = new Map<string, typeof rows>()
    for (const r of rows) byNotice.set(r.notification_id, [...(byNotice.get(r.notification_id) ?? []), r])

    for (const list of byNotice.values()) {
      const first = list[0]
      const category = first.category ?? 'offers'
      const live = list.filter(r => !r.disabled && r.device_user === r.user_id)
      if (!flagOn || !live.length || !(await pushAllowed(first.user_id, category).catch(() => false))) {
        out.skipped += list.length
        continue
      }
      const now: Device[] = []
      for (const r of live) {
        const until = quietUntil(r.timezone)
        if (until) {
          await query(
            `INSERT INTO push_queue (notification_id, push_device_id, send_after) VALUES ($1, $2, $3) ON CONFLICT (notification_id, push_device_id) DO NOTHING`,
            [r.notification_id, r.device_id, until]
          )
        } else now.push({ id: r.device_id, token: r.token, timezone: r.timezone })
      }
      if (!now.length) continue
      const res = await sendNow(
        {
          userId: first.user_id,
          kind: first.kind,
          category,
          notificationId: first.notification_id,
          title: first.title,
          body: first.body ?? '',
          link: first.link || '/',
          image: pushImage(first.image_url),
        },
        now
      ).catch(e => ({ status: 'failed' as const, reason: String(e?.message ?? e) }))
      out[res.status] += now.length
      if (res.status === 'sent') {
        await query(
          `UPDATE email_campaigns_sent SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"status":"sent","reason":null}'::jsonb
            WHERE campaign_kind = $1 AND user_id = $2 AND reference_id = $3
              AND unsubscribed_at IS NULL AND bounced_at IS NULL AND complained_at IS NULL`,
          [first.kind, first.user_id, `push:${first.kind}`]
        ).catch(() => {})
      }
    }
  }
  return out
}
