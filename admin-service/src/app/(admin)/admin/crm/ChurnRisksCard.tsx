'use client'

import { Dialog } from '@/components/admin/kit'
import { useHasScope } from '@/contexts/AdminScopesContext'

import { useState } from 'react'
import Link from 'next/link'
import CrmMailerPanel from './CrmMailerPanel'
import { ap } from '@/lib/shared/admin-path'

interface ChurnRisk {
  id: string
  name: string
  email: string
  score: number
  ltv: number
  daysSinceLastOrder: number | null
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ml-2 ${
        score < 20 ? 'bg-red-200 text-red-700 dark:text-red-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'
      }`}
    >
      {score}
    </span>
  )
}

function Row({ c, large }: { c: ChurnRisk; large?: boolean }) {
  return (
    <Link
      href={ap(`/admin/customers/${c.id}/view`)}
      className={`flex items-center justify-between ${large ? 'text-sm py-2.5' : 'text-sm py-1'} hover:bg-surface-secondary/50 px-2 -mx-2 rounded transition-colors`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate font-medium">{c.name}</p>
        <p className="text-[10px] text-foreground-muted break-words">
          <span className="hover:underline">{c.email}</span>
          {' · '}₹{Math.round(c.ltv).toLocaleString('en-IN')} lifetime
          {c.daysSinceLastOrder != null && ` · ${c.daysSinceLastOrder}d quiet`}
        </p>
      </div>
      <ScoreBadge score={c.score} />
    </Link>
  )
}

export default function ChurnRisksCard({ items }: { items: ChurnRisk[] }) {
  const canMail = useHasScope('mailer:write')
  const [open, setOpen] = useState(false)
  const preview = items.slice(0, 3)
  const hasMore = items.length > 3

  return (
    <>
      <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Top Churn Risks</h2>
          {hasMore && (
            <button onClick={() => setOpen(true)} className="text-xs text-accent-500 hover:text-accent-600 font-medium">
              View all ({items.length}) →
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">No customers below health 40.</p>
        ) : (
          <div className="space-y-0.5">
            {preview.map(c => (
              <Row key={c.id} c={c} />
            ))}
            {hasMore && (
              <button
                onClick={() => setOpen(true)}
                className="w-full text-center text-xs text-foreground-muted hover:text-foreground pt-2 pb-0.5 transition-colors"
              >
                +{items.length - 3} more
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Top Churn Risks" description={<>{items.length} customers · health score below 40</>} size="full" zIndex="z-[300]">
              {/* Body: two columns */}
              <div className="flex flex-1 min-h-0 flex-col overflow-y-auto divide-y divide-border-default md:flex-row md:overflow-hidden md:divide-y-0 md:divide-x">
                {/* Left: customer list */}
                <div className={`flex flex-col bg-surface-secondary/30 ${canMail ? 'shrink-0 md:w-2/5' : 'flex-1'}`}>
                  <div className="px-6 pt-4 pb-2 shrink-0 border-b border-border-default">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Customers</h3>
                  </div>
                  <div className="overflow-y-auto flex-1 px-6 py-4 divide-y divide-border-default">
                    {items.map(c => (
                      <Row key={c.id} c={c} large />
                    ))}
                  </div>
                </div>
                {/* Right: mailer panel */}
                {canMail && (
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Send message</h3>
                      <Link
                        href={ap('/admin/customers?segment=dormant')}
                        className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                        onClick={() => setOpen(false)}
                      >
                        View all in Customers →
                      </Link>
                    </div>
                    <div className="overflow-y-auto flex-1 px-6 pb-6">
                      <CrmMailerPanel
                        segmentKey="at_risk"
                        segmentLabel="Churn Risk"
                        recipientCount={items.length}
                        onClose={() => setOpen(false)}
                      />
                    </div>
                  </div>
                )}
              </div>
      </Dialog>
    </>
  )
}
