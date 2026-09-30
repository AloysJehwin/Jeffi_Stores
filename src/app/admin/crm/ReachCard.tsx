'use client'

import { CompactStat, numStr, pctStr } from '@/components/admin/dashboard/Primitives'
import type { Reach } from '@/lib/crm-insights-shared'

function Channel({ label, sent, failed }: { label: string; sent: number; failed: number }) {
  const failRate = sent > 0 ? (failed / sent) * 100 : null
  return (
    <CompactStat
      label={label}
      value={numStr(sent)}
      sub={failed > 0 ? `${numStr(failed)} failed (${pctStr(failRate, 0)})` : 'no failures'}
    />
  )
}

export default function ReachCard({ reach }: { reach: Reach }) {
  const empty =
    reach.emailSent === 0 &&
    reach.whatsappSent === 0 &&
    reach.smsSent === 0 &&
    reach.campaignSent === 0 &&
    reach.customers === 0
  if (empty) return null

  const emailPct = reach.customers > 0 ? (reach.hasEmail / reach.customers) * 100 : null
  const phonePct = reach.customers > 0 ? (reach.hasPhone / reach.customers) * 100 : null
  const optInPct = reach.customers > 0 ? (reach.marketingOptIn / reach.customers) * 100 : null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">
        Reach and Deliverability
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Channel label="Email" sent={reach.emailSent} failed={reach.emailFailed} />
        <Channel label="WhatsApp" sent={reach.whatsappSent} failed={reach.whatsappFailed} />
        <Channel label="SMS" sent={reach.smsSent} failed={reach.smsFailed} />
        <Channel label="Campaigns" sent={reach.campaignSent} failed={reach.campaignFailed} />
      </div>

      <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">Contactability</p>
      <div className="grid grid-cols-3 gap-2">
        <CompactStat
          label="Has email"
          value={pctStr(emailPct, 0)}
          sub={`${numStr(reach.hasEmail)} of ${numStr(reach.customers)}`}
        />
        <CompactStat label="Has phone" value={pctStr(phonePct, 0)} sub={numStr(reach.hasPhone)} />
        <CompactStat label="Marketing opt-in" value={pctStr(optInPct, 0)} sub={numStr(reach.marketingOptIn)} />
      </div>
    </div>
  )
}
