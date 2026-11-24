'use client'

import { Empty, Section, Table, count, type Col } from '@/components/admin/channels/ui'
import { Donut, PALETTE } from '@/components/admin/traffic/charts'
import { rateText, ratio } from '@/components/admin/traffic/shared'
import type { ShowcaseShareRow } from '@/lib/traffic/showcase-types'

export { Change, Note, PointChange, bucketLabel, rateText, ratio } from '@/components/admin/traffic/shared'

export const TARGET_LABELS: Record<string, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  map: 'Map / directions',
  social: 'Social profile',
  link: 'Other link',
}
export const targetLabel = (t: string) => TARGET_LABELS[t] ?? t

/** "1m 05s", "42s". */
export function duration(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) return '-'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

let regionNames: Intl.DisplayNames | null | undefined
/** "IN" -> "India"; anything else as it is. */
export function countryName(code: string | null | undefined) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return code || '-'
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  return regionNames?.of(code) ?? code
}

/** A donut and table of visits by one trait, with each value's contact rate. */
export function ShareCard({ title, rows, colors, label }: { title: string; rows: ShowcaseShareRow[]; colors?: Record<string, string>; label?: (key: string) => string }) {
  const total = rows.reduce((s, r) => s + r.sessions, 0)
  const name = label ?? ((k: string) => k)
  const cols: Col<ShowcaseShareRow>[] = [
    { key: 'key', label: title, render: r => name(r.key), sort: r => name(r.key) },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'share', label: 'Share', num: true, sort: r => r.sessions, render: r => rateText(r.sessions, total, 0) },
    { key: 'conv', label: 'Contact rate', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 1) },
  ]
  return (
    <Section title={title}>
      {total === 0 ? (
        <Empty msg="No visits with this detail in this period" />
      ) : (
        <div className="space-y-4">
          <Donut size={110} segments={rows.slice(0, 8).map((r, i) => ({ label: name(r.key), value: r.sessions, color: colors?.[r.key] ?? PALETTE[i % PALETTE.length] }))} />
          <Table rows={rows} cols={cols} rowKey={r => r.key} pageSize={10} />
        </div>
      )}
    </Section>
  )
}
