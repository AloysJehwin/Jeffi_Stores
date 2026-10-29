import type { AttachmentKind } from '../../types/support'

// Chat dates in IST, by hand: Hermes' Intl can't be relied on for timeZone on every device.

const IST_MS = 330 * 60_000
const DAY_MS = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A Date whose UTC fields read as the IST wall clock. */
const ist = (t: number) => new Date(t + IST_MS)
const dayKey = (t: number) => ist(t).toISOString().slice(0, 10)

/** "Today", "Yesterday", a weekday within the week, else the date. */
export function dayLabel(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  const k = dayKey(t)
  if (k === dayKey(now)) return 'Today'
  if (k === dayKey(now - DAY_MS)) return 'Yesterday'
  const d = ist(t)
  if (now - t < 6 * DAY_MS) return WEEKDAYS[d.getUTCDay()]
  const year = d.getUTCFullYear() === ist(now).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a).getTime()) === dayKey(new Date(b).getTime())

/** "3:05 pm" */
export function timeLabel(iso: string): string {
  const d = ist(new Date(iso).getTime())
  const h = d.getUTCHours()
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** "12 Oct 2026" */
export function shortDate(iso: string): string {
  const d = ist(new Date(iso).getTime())
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export const kindOf = (mime: string, name = ''): AttachmentKind =>
  mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : mime === 'application/pdf' || /\.pdf$/i.test(name)
          ? 'pdf'
          : /\.(docx?|xlsx?|pptx?|csv|txt)$/i.test(name)
            ? 'doc'
            : 'other'
