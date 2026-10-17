'use client'

import { Empty, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import type { AudienceData, ShareRow } from '@/lib/traffic/types'
import { Donut, HBars, PALETTE } from './charts'
import { Note, rateText, ratio } from './shared'

const DEVICE_COLORS: Record<string, string> = { Mobile: '#3b82f6', Tablet: '#8b5cf6', Desktop: '#22c55e', Bot: '#6b7280' }

function ShareCard({ title, rows, colors }: { title: string; rows: ShareRow[]; colors?: Record<string, string> }) {
  const total = rows.reduce((s, r) => s + r.sessions, 0)
  const cols: Col<ShareRow>[] = [
    { key: 'key', label: title, render: r => r.key, sort: r => r.key },
    { key: 'sessions', label: 'Sessions', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'share', label: 'Share', num: true, sort: r => r.sessions, render: r => rateText(r.sessions, total, 0) },
    { key: 'conv', label: 'Conversion', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 2) },
  ]
  return (
    <Section title={title}>
      {total === 0 ? (
        <Empty msg="No sessions in this period" />
      ) : (
        <div className="space-y-4">
          <Donut size={110} segments={rows.slice(0, 8).map((r, i) => ({ label: r.key, value: r.sessions, color: colors?.[r.key] ?? PALETTE[i % PALETTE.length] }))} />
          <Table rows={rows} cols={cols} rowKey={r => r.key} pageSize={10} />
        </div>
      )}
    </Section>
  )
}

export default function AudienceTab({ data }: { data: AudienceData }) {
  const sessions = data.devices.reduce((s, r) => s + r.sessions, 0)
  if (!sessions && !data.states.length) return <Empty msg="No tracked sessions or online orders in this period yet." />
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <ShareCard title="Device" rows={data.devices} colors={DEVICE_COLORS} />
        <ShareCard title="Browser" rows={data.browsers} />
        <ShareCard title="Operating system" rows={data.os} />
        <ShareCard title="New vs returning" rows={data.newReturning} colors={{ New: '#84cc16', Returning: '#3b82f6' }} />
        <ShareCard title="Signed in vs guest" rows={data.loggedIn} colors={{ 'Signed in': '#a855f7', Guest: '#94a3b8' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Top states (from orders)">
          <HBars
            empty="No online orders with a shipping address in this period"
            rows={data.states.map(s => ({ key: s.key, label: s.key, value: s.orders, right: `${count(s.orders)} · ${money(s.revenue)}` }))}
          />
        </Section>
        <Section title="Top cities (from orders)">
          <HBars
            color="rgba(59,130,246,0.6)"
            empty="No online orders with a shipping address in this period"
            rows={data.cities.map(s => ({ key: s.key, label: s.key, value: s.orders, right: `${count(s.orders)} · ${money(s.revenue)}` }))}
          />
        </Section>
      </div>

      <Note>
        Device, browser and OS come from each session&apos;s user agent; bots are shown under Device and left out of
        Browser and OS. A visitor is new on their first session with no visit in the 90 days before the period (matched
        by sign-in, else IP and device). Location comes from order shipping addresses, not IP.
      </Note>
    </div>
  )
}
