import type { SupportMessage } from '@/lib/support/types'

const IST = 'Asia/Kolkata'

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST })

/** "Today", "Yesterday", a weekday within the week, else the date. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const k = dayKey(d)
  if (k === dayKey(now)) return 'Today'
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: IST })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', timeZone: IST })
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b))

export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })

export const fullTimeLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** "2m", "1h", "3d" — how long ago, for inbox rows. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

export function previewOf(m: Pick<SupportMessage, 'text' | 'attachments' | 'payloads'>): string {
  if (m.text) return m.text
  if (m.attachments?.length) return m.attachments.length === 1 ? `Attachment: ${m.attachments[0].name}` : `${m.attachments.length} attachments`
  const p = m.payloads?.[0]
  if (p?.type === 'confirm') return p.title
  if (p?.type === 'orders') return `${p.orders.length} order(s)`
  return ''
}
