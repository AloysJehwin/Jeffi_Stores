// Shared campaign presentation helpers — used by the desktop card (CampaignsListClient) and the mobile
// list/detail sheet (CampaignsMobileList) so both render channels, rates and stats identically.
import type { ReactNode } from 'react'
import { Bell } from 'lucide-react'
import { campaignSupportsPush } from '@/lib/campaigns/push-kinds'
import type { DraftLockChip } from '@/lib/client/draft-lock-client'

export interface CampaignRow {
  kind: string
  name: string
  description: string | null
  enabled: boolean
  delay_hours: number
  discount_percent: number
  total_sent: number
  total_opened: number
  total_clicked: number
  total_converted: number
  total_unsubscribed: number
  revenue_attributed: string | number
  sent_last_24h: string | null
  last_run_at: string | null
  draft_fields: Record<string, unknown> | null
  /** Who holds the pending draft (list endpoint only). */
  draft_lock?: DraftLockChip | null
  updated_at: string | null
  parameters?: Record<string, unknown> | null
  scenario_kind?: string | null
  // App push markers (the detail endpoint only).
  push_sent?: string | number | null
  push_waiting?: string | number | null
  push_skipped?: string | number | null
  push_failed?: string | number | null
  push_opened?: string | number | null
  push_converted?: string | number | null
}

export type CampaignChannel = 'email' | 'whatsapp' | 'push'

const WA_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'order_shipped',
  'order_delivered',
  'reorder_reminder',
  'back_in_stock',
  'back_in_stock_alert',
]

/** `on` is Site Controls' switches (useMessagingChannels): an off channel gets no chip or filter. */
export function getChannels(
  kind: string,
  params: Record<string, unknown> | null | undefined,
  scenarioKind: string | null | undefined,
  on: { whatsapp: boolean; push: boolean }
): CampaignChannel[] {
  const out: CampaignChannel[] = on.whatsapp && WA_KINDS.includes(kind) ? ['email', 'whatsapp'] : ['email']
  if (on.push && params?.pushEnabled === true && (campaignSupportsPush(kind) || campaignSupportsPush(scenarioKind ?? ''))) out.push('push')
  return out
}

/** "Also send via SMS/WhatsApp/app push" params of a channel Site Controls has switched off. */
export function channelParamOff(key: string, on: { sms: boolean; whatsapp: boolean; push: boolean }): boolean {
  return (key === 'smsEnabled' && !on.sms) || (key === 'whatsappEnabled' && !on.whatsapp) || (key === 'pushEnabled' && !on.push)
}

export function rate(num: number, den: number): string {
  if (den === 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

export function ChannelChip({ channel }: { channel: CampaignChannel }): ReactNode {
  if (channel === 'push')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/10 text-orange-700 dark:text-orange-400">
        <Bell className="w-2.5 h-2.5" />
        App push
      </span>
    )
  if (channel === 'whatsapp')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-700 dark:text-green-400">
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.975-1.407A9.953 9.953 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.946 7.946 0 01-4.073-1.117l-.292-.173-3.012.852.838-3.028-.19-.31A7.944 7.944 0 014 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z" />
        </svg>
        WhatsApp
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400">
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m2 7 10 7 10-7" />
      </svg>
      Email
    </span>
  )
}

/** Opens the customers behind one number (see CampaignRecipientsDialog); omitted, numbers are plain text. */
export type OpenMetric = (metric: CampaignMetric, label: string) => void
export type CampaignMetric =
  | 'sent' | 'opened' | 'clicked' | 'converted' | 'revenue' | 'unsubscribed'
  | 'push_sent' | 'push_waiting' | 'push_skipped' | 'push_failed' | 'push_opened' | 'push_converted'

function StatTile({ label, value, display, cls = 'text-foreground', sub, metric, onOpen }: {
  label: string
  value: number
  display?: string
  cls?: string
  sub?: string
  metric: CampaignMetric
  onOpen?: OpenMetric
}): ReactNode {
  const text = display ?? value.toLocaleString('en-IN')
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-foreground-muted">{label}</p>
      {onOpen && value > 0 ? (
        <button
          type="button"
          onClick={() => onOpen(metric, label)}
          title={`See the customers: ${label.toLowerCase()}`}
          className={`text-lg font-bold tabular-nums underline decoration-dotted decoration-1 underline-offset-4 hover:decoration-solid ${cls}`}
        >
          {text}
        </button>
      ) : (
        <p className={`text-lg font-bold tabular-nums ${cls}`}>{text}</p>
      )}
      {sub && <p className="text-[10px] text-foreground-muted">{sub}</p>}
    </div>
  )
}

/** The six campaign stat tiles, shared by the desktop card and the mobile detail sheet. */
export function CampaignStatsGrid({ c, onOpen }: { c: CampaignRow; onOpen?: OpenMetric }): ReactNode {
  const sent = Number(c.total_sent)
  const revenue = Math.round(Number(c.revenue_attributed))
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatTile label="Sent" value={sent} metric="sent" onOpen={onOpen} />
      <StatTile label="Opened" value={Number(c.total_opened)} sub={rate(Number(c.total_opened), sent)} metric="opened" onOpen={onOpen} />
      <StatTile label="Clicked" value={Number(c.total_clicked)} sub={rate(Number(c.total_clicked), sent)} metric="clicked" onOpen={onOpen} />
      <StatTile
        label="Converted"
        value={Number(c.total_converted)}
        cls="text-green-600 dark:text-green-400"
        sub={rate(Number(c.total_converted), sent)}
        metric="converted"
        onOpen={onOpen}
      />
      <StatTile label="Revenue" value={revenue} display={`₹${revenue.toLocaleString('en-IN')}`} metric="revenue" onOpen={onOpen} />
      <StatTile
        label="Unsub"
        value={Number(c.total_unsubscribed)}
        cls="text-red-500"
        sub={rate(Number(c.total_unsubscribed), sent)}
        metric="unsubscribed"
        onOpen={onOpen}
      />
    </div>
  )
}

/** App push outcomes of a scenario (its push:<kind> markers). Opens are taps on the notification. */
export function CampaignPushStats({ c, onOpen }: { c: CampaignRow; onOpen?: OpenMetric }): ReactNode {
  const n = (v: unknown) => Number(v ?? 0)
  const sent = n(c.push_sent)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatTile label="Sent" value={sent} metric="push_sent" onOpen={onOpen} />
      <StatTile label="Waiting" value={n(c.push_waiting)} sub="quiet hours" metric="push_waiting" onOpen={onOpen} />
      <StatTile label="Skipped" value={n(c.push_skipped)} sub="daily limit, push off" metric="push_skipped" onOpen={onOpen} />
      <StatTile label="Failed" value={n(c.push_failed)} cls="text-red-500" metric="push_failed" onOpen={onOpen} />
      <StatTile label="Opened" value={n(c.push_opened)} sub={rate(n(c.push_opened), sent)} metric="push_opened" onOpen={onOpen} />
      <StatTile
        label="Converted"
        value={n(c.push_converted)}
        cls="text-green-600 dark:text-green-400"
        sub={rate(n(c.push_converted), sent)}
        metric="push_converted"
        onOpen={onOpen}
      />
    </div>
  )
}
