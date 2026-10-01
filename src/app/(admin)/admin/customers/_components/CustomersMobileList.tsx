'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface Props {
  customers: any[]
  backUrl: string
  pagination: React.ReactNode
}

function fullName(customer: any) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'
}

function statusLabel(customer: any) {
  return customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'
}

function statusBadge(customer: any) {
  if (customer.is_flagged) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
  if (customer.is_active) return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
}

function healthBarColor(score: number | null | undefined) {
  if (score == null) return 'bg-zinc-300 dark:bg-zinc-700'
  if (score >= 70) return 'bg-green-500'
  if (score >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

function healthBadge(score: number) {
  if (score >= 70) return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
  if (score >= 40) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium break-words">{value}</p>
    </div>
  )
}

export default function CustomersMobileList({ customers, backUrl, pagination }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<any>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(customer: any): MobileAction[] {
    return [
      {
        key: 'view',
        label: 'View customer profile',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/customers/${customer.id}?back=${encodeURIComponent(backUrl)}`)),
      },
    ]
  }

  return (
    <div className="md:hidden space-y-3">
      {customers.length === 0 ? (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
          No customers found.
        </div>
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
                <span
                  className={`absolute left-0 top-0 bottom-0 w-1 ${healthBarColor(score)}`}
                  aria-hidden="true"
                />
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground truncate">{fullName(customer)}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {score != null && (
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${healthBadge(score)}`}>
                        {score}
                      </span>
                    )}
                    {customer.user_type === 'business' && (
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          customer.bp_approval_status === 'approved'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                            : customer.bp_approval_status === 'rejected'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        Biz
                      </span>
                    )}
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadge(customer)}`}>
                      {statusLabel(customer)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-foreground-muted truncate">{customer.email}</p>
                {customer.tags && customer.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {customer.tags.slice(0, 4).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-600 dark:text-accent-400"
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
                className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
              >
                Actions
              </button>
            }
          >
            {selected && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusBadge(selected)}`}>
                    {statusLabel(selected)}
                  </span>
                  {selected.user_type === 'business' && (
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                        selected.bp_approval_status === 'approved'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                          : selected.bp_approval_status === 'rejected'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      Business
                      {selected.bp_approval_status !== 'approved'
                        ? ` · ${selected.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending'}`
                        : ''}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary">
                  <Field label="Total Orders" value={Number(selected.order_count)} />
                  <Field
                    label="Lifetime Spend"
                    value={`Rs. ${Number(selected.lifetime_value || 0).toLocaleString('en-IN', {
                      maximumFractionDigits: 0,
                    })}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
                  <Field label="Phone" value={selected.phone || '—'} />
                  <Field label="Health" value={selected.health_score == null ? '—' : selected.health_score} />
                  <Field
                    label="Joined"
                    value={new Date(selected.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  />
                  {selected.bp_company_name && <Field label="Company" value={selected.bp_company_name} />}
                </div>
                {selected.tags && selected.tags.length > 0 && (
                  <div className="border-t border-border-default pt-4">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-600 dark:text-accent-400"
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
      {pagination}
    </div>
  )
}
