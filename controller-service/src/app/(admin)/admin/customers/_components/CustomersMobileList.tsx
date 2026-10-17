'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { EmptyState, Field, Fields, badgeCls } from '@/components/admin/kit'
import { businessLabel, businessTone, customerStatus, fullName, healthTone, inr } from './status-maps'

interface Props {
  customers: any[]
  backUrl: string
}

function healthBarColor(score: number | null | undefined) {
  if (score == null) return 'bg-border-default'
  if (score >= 70) return 'bg-green-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

const StatusChip = ({ c }: { c: any }) => (
  <span className={badgeCls(customerStatus(c).tone)}>{customerStatus(c).label}</span>
)
const BizChip = ({ c, short }: { c: any; short?: boolean }) =>
  c.user_type === 'business' ? (
    <span className={badgeCls(businessTone(c.bp_approval_status))}>
      {short ? 'Biz' : businessLabel(c.bp_approval_status)}
    </span>
  ) : null

export default function CustomersMobileList({ customers, backUrl }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<any>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(customer: any): MobileAction[] {
    return [
      {
        key: 'view',
        label: 'View customer profile',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/customers/${customer.id}/view?back=${encodeURIComponent(backUrl)}`)),
      },
    ]
  }

  return (
    <div className="space-y-3">
      {customers.length === 0 ? (
        <EmptyState title="No customers found." />
      ) : (
        <>
          {customers.map((customer: any) => {
            const score = customer.health_score
            return (
              <MobileListCard
                key={customer.id}
                ariaLabel={`Open ${fullName(customer)}`}
                onTap={() => setSelected(customer)}
                className="relative pl-5 overflow-hidden"
              >
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${healthBarColor(score)}`} aria-hidden="true" />
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground truncate">{fullName(customer)}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {score != null && (
                      <span className={`${badgeCls(healthTone(score))} font-bold tabular-nums`}>{score}</span>
                    )}
                    <BizChip c={customer} short />
                    <StatusChip c={customer} />
                  </div>
                </div>
                <p className="text-xs text-foreground-muted truncate">{customer.email}</p>
                {customer.tags && customer.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {customer.tags.slice(0, 4).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-500"
                      >
                        {tag}
                      </span>
                    ))}
                    {customer.tags.length > 4 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-surface-secondary text-foreground-muted">
                        +{customer.tags.length - 4}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-xs text-foreground-muted">{Number(customer.order_count)} orders</span>
                  <span className="text-xs text-foreground-muted">
                    Joined {new Date(customer.created_at).toLocaleDateString('en-IN')}
                  </span>
                </div>
              </MobileListCard>
            )
          })}

          <MobileDetailSheet
            open={!!selected}
            onClose={() => setSelected(null)}
            title={selected ? fullName(selected) : ''}
            subtitle={selected?.email}
            footer={
              <button
                type="button"
                onClick={() => setActionsOpen(true)}
                className="control-md w-full bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                Actions
              </button>
            }
          >
            {selected && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusChip c={selected} />
                  <BizChip c={selected} />
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-secondary p-3">
                  <Fields cols={1}>
                    <Field label="Total Orders" value={Number(selected.order_count)} />
                  </Fields>
                  <Fields cols={1}>
                    <Field label="Lifetime Spend" value={inr(selected.lifetime_value)} />
                  </Fields>
                </div>
                <div className="border-t border-border-default pt-4">
                  <Fields>
                    <Field label="Phone" value={selected.phone} />
                    <Field label="Health" value={selected.health_score == null ? null : selected.health_score} />
                    <Field
                      label="Joined"
                      value={new Date(selected.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    />
                    {selected.bp_company_name && <Field label="Company" value={selected.bp_company_name} />}
                  </Fields>
                </div>
                {selected.tags && selected.tags.length > 0 && (
                  <div className="border-t border-border-default pt-4">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </MobileDetailSheet>

          <MobileActionSheet
            open={actionsOpen && !!selected}
            onClose={() => setActionsOpen(false)}
            title={selected ? fullName(selected) : undefined}
            actions={selected ? buildActions(selected) : []}
          />
        </>
      )}
    </div>
  )
}
