// Shared campaign presentation helpers — used by the desktop card (CampaignsListClient) and the mobile
// list/detail sheet (CampaignsMobileList) so both render channels, rates and stats identically.
import type { ReactNode } from 'react'

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
  updated_at: string | null
}

const WA_KINDS = [
  'abandoned_cart',
  'abandoned_checkout',
  'order_shipped',
  'order_delivered',
  'reorder_reminder',
  'back_in_stock',
  'back_in_stock_alert',
]

export function getChannels(kind: string): ('email' | 'whatsapp')[] {
  return WA_KINDS.includes(kind) ? ['email', 'whatsapp'] : ['email']
}

export function rate(num: number, den: number): string {
  if (den === 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

export function ChannelChip({ channel }: { channel: 'email' | 'whatsapp' }): ReactNode {
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

/** The six campaign stat tiles, shared by the desktop card and the mobile detail sheet. */
export function CampaignStatsGrid({ c }: { c: CampaignRow }): ReactNode {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Sent</p>
        <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_sent).toLocaleString('en-IN')}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Opened</p>
        <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_opened).toLocaleString('en-IN')}</p>
        <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_opened), Number(c.total_sent))}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Clicked</p>
        <p className="text-lg font-bold text-foreground tabular-nums">{Number(c.total_clicked).toLocaleString('en-IN')}</p>
        <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_clicked), Number(c.total_sent))}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Converted</p>
        <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">
          {Number(c.total_converted).toLocaleString('en-IN')}
        </p>
        <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_converted), Number(c.total_sent))}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Revenue</p>
        <p className="text-lg font-bold text-foreground tabular-nums">
          ₹{Math.round(Number(c.revenue_attributed)).toLocaleString('en-IN')}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Unsub</p>
        <p className="text-lg font-bold text-red-500 tabular-nums">
          {Number(c.total_unsubscribed).toLocaleString('en-IN')}
        </p>
        <p className="text-[10px] text-foreground-muted">{rate(Number(c.total_unsubscribed), Number(c.total_sent))}</p>
      </div>
    </div>
  )
}
