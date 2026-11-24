'use client'

import { Empty } from '@/components/admin/channels/ui'
import type { ShowcaseAudience } from '@/lib/traffic/showcase-types'
import { Note, ShareCard, countryName } from './shared'
import { chartColor } from '@/components/admin/traffic/charts'

const DEVICE_COLORS: Record<string, string> = { Mobile: chartColor(1), Tablet: chartColor(3), Desktop: chartColor(2) }
const NETWORK_LABELS: Record<string, string> = { '4g': '4G or faster', '3g': '3G', '2g': '2G', 'slow-2g': 'Slow 2G' }

export default function AudienceTab({ data }: { data: ShowcaseAudience }) {
  const visits = data.devices.reduce((s, r) => s + r.sessions, 0)
  if (!visits) return <Empty msg="No visits in this period yet." />
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <ShareCard title="Device" rows={data.devices} colors={DEVICE_COLORS} />
        <ShareCard title="Browser" rows={data.browsers} />
        <ShareCard title="Operating system" rows={data.os} />
        <ShareCard title="New vs returning" rows={data.newReturning} colors={{ New: chartColor(2), Returning: chartColor(1) }} />
        <ShareCard title="Country" rows={data.countries} label={countryName} />
        <ShareCard title="Language" rows={data.languages} />
        <ShareCard title="Time zone" rows={data.timezones} />
        <ShareCard title="Screen size" rows={data.screens} />
        <ShareCard title="Connection" rows={data.networks} label={k => NETWORK_LABELS[k] ?? k} />
        {data.regions.length > 0 && <ShareCard title="State / region" rows={data.regions} />}
        {data.cities.length > 0 && <ShareCard title="City" rows={data.cities} />}
      </div>

      <Note>
        Device, browser and system come from the visitor&apos;s browser; automated visitors are left out. Country comes
        from the visitor&apos;s time zone or language setting (no IP address is kept), so a traveller shows under home.
        A visitor is first-time when the same network and device has not visited in the 90 days before. Connection is
        the speed the browser reports.
      </Note>
    </div>
  )
}
