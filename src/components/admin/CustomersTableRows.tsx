'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import Tooltip from '@/components/ui/Tooltip'
import HoverCard from '@/components/ui/HoverCard'
import { ap } from '@/lib/shared/admin-path'

function CustomerDetailModal({ customer, onClose, backUrl }: { customer: any; onClose: () => void; backUrl: string }) {
  if (typeof document === 'undefined') return null
  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'
  const initials = [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="flex items-center gap-3 min-w-0 pr-4">
            <div className="w-10 h-10 rounded-xl bg-surface-secondary border border-border-default flex items-center justify-center text-sm font-bold text-foreground shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground leading-tight truncate">{fullName}</h2>
              <p className="text-xs text-foreground-muted mt-0.5 truncate">{customer.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href={ap(`/admin/customers/${customer.id}?back=${encodeURIComponent(backUrl)}`)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
            >
              Full Profile
            </Link>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span
              className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                customer.is_flagged
                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                  : customer.is_active
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
              }`}
            >
              {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
            </span>
            {customer.user_type === 'business' && (
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                  customer.bp_approval_status === 'approved'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : customer.bp_approval_status === 'rejected'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                }`}
              >
                Business
                {customer.bp_approval_status !== 'approved'
                  ? ` · ${customer.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending'}`
                  : ''}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Total Orders</p>
              <p className="text-sm font-bold text-foreground">{Number(customer.order_count)}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Lifetime Spend</p>
              <p className="text-sm font-bold text-foreground">
                ₹{Number(customer.lifetime_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            {customer.phone && (
              <div className="flex items-center gap-2 text-foreground-secondary">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <span>{customer.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-foreground-secondary">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>
                Joined{' '}
                {new Date(customer.created_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function CustomersTableRows({
  customers,
  backUrl = '/admin/customers',
}: {
  customers: any[]
  backUrl?: string
}) {
  const [selected, setSelected] = useState<any>(null)

  if (!customers.length) {
    return (
      <tr>
        <td colSpan={8} className="px-6 py-12 text-center text-foreground-muted">
          No customers found.
        </td>
      </tr>
    )
  }

  return (
    <>
      {selected && <CustomerDetailModal customer={selected} onClose={() => setSelected(null)} backUrl={backUrl} />}
      {customers.map((customer: any) => (
        <tr
          key={customer.id}
          className="hover:bg-surface-secondary cursor-pointer"
          onClick={() => setSelected(customer)}
        >
          <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
            <HoverCard
              trigger={
                <Link
                  href={ap(`/admin/customers/${customer.id}?back=${encodeURIComponent(backUrl)}`)}
                  className="text-sm font-medium text-accent-500 hover:text-accent-600 underline decoration-dotted underline-offset-2 whitespace-nowrap"
                >
                  {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}
                </Link>
              }
              align="left"
              side="bottom"
              width="260px"
            >
              <div className="p-3 space-y-2">
                <p className="font-semibold text-foreground text-sm">
                  {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {customer.email && (
                    <>
                      <span className="text-foreground-muted">Email</span>
                      <span className="text-foreground truncate">{customer.email}</span>
                    </>
                  )}
                  {customer.phone && (
                    <>
                      <span className="text-foreground-muted">Phone</span>
                      <span className="text-foreground">{customer.phone}</span>
                    </>
                  )}
                  <span className="text-foreground-muted">Orders</span>
                  <span className="text-foreground font-medium">{Number(customer.order_count)}</span>
                  <span className="text-foreground-muted">Lifetime</span>
                  <span className="text-foreground font-semibold">
                    ₹{Number(customer.lifetime_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                  <span className="text-foreground-muted">Status</span>
                  <span
                    className={`font-medium ${customer.is_flagged ? 'text-red-600 dark:text-red-400' : customer.is_active ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}
                  >
                    {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {customer.user_type === 'business' && (
                    <>
                      <span className="text-foreground-muted">Type</span>
                      <span
                        className={`font-medium ${customer.bp_approval_status === 'approved' ? 'text-blue-600 dark:text-blue-400' : customer.bp_approval_status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
                      >
                        Business{customer.bp_company_name ? ` · ${customer.bp_company_name}` : ''}
                      </span>
                    </>
                  )}
                  <span className="text-foreground-muted">Joined</span>
                  <span className="text-foreground">
                    {new Date(customer.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {customer.tags && customer.tags.length > 0 && (
                  <div className="pt-2 border-t border-border-default">
                    <p className="text-[10px] uppercase tracking-wider text-foreground-muted mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {customer.tags.map((tag: string) => (
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
            </HoverCard>
            {customer.tags && customer.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5 max-w-[220px]">
                {customer.tags.slice(0, 3).map((tag: string) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-600 dark:text-accent-400 whitespace-nowrap"
                  >
                    {tag}
                  </span>
                ))}
                {customer.tags.length > 3 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-surface-secondary text-foreground-muted">
                    +{customer.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="text-sm text-foreground">{customer.email}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="text-sm text-foreground">{customer.phone || '—'}</div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <Tooltip
              content={new Date(customer.created_at).toLocaleString('en-IN', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            >
              <span className="text-sm text-foreground cursor-default">
                {new Date(customer.created_at).toLocaleDateString('en-IN')}
              </span>
            </Tooltip>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <Tooltip content={`${Number(customer.order_count)} total orders placed`}>
              <span className="text-sm text-foreground cursor-default">{Number(customer.order_count)}</span>
            </Tooltip>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            {customer.health_score == null ? (
              <span className="text-xs text-foreground-muted">—</span>
            ) : (
              <Tooltip
                content={`Churn risk: ${customer.churn_risk || 'unknown'}${customer.trend_delta_30d ? ` · ${customer.trend_delta_30d > 0 ? '+' : ''}${customer.trend_delta_30d} (30d)` : ''}`}
              >
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded cursor-default ${
                    customer.health_score >= 70
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : customer.health_score >= 40
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  }`}
                >
                  {customer.health_score}
                  {customer.trend_delta_30d > 5 && <span className="text-green-600 dark:text-green-400">▲</span>}
                  {customer.trend_delta_30d < -5 && <span className="text-red-600 dark:text-red-400">▼</span>}
                </span>
              </Tooltip>
            )}
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div className="flex flex-col gap-1">
              <Tooltip
                content={
                  customer.is_flagged
                    ? 'Account flagged — potential fraud or policy violation'
                    : customer.is_active
                      ? 'Account in good standing'
                      : 'Account deactivated'
                }
              >
                <span
                  className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-default ${
                    customer.is_flagged
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                      : customer.is_active
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                  }`}
                >
                  {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                </span>
              </Tooltip>
              {customer.user_type === 'business' && (
                <Tooltip
                  content={`Business partner · ${customer.bp_approval_status === 'approved' ? 'Approved' : customer.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending approval'}${customer.bp_company_name ? ` · ${customer.bp_company_name}` : ''}`}
                >
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full cursor-default ${
                      customer.bp_approval_status === 'approved'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                        : customer.bp_approval_status === 'rejected'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    Business
                    {customer.bp_approval_status !== 'approved'
                      ? ` · ${customer.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending'}`
                      : ''}
                  </span>
                </Tooltip>
              )}
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-end gap-1">
              <Link
                href={ap(`/admin/customers/${customer.id}?back=${encodeURIComponent(backUrl)}`)}
                title="View Customer"
                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-secondary hover:text-accent-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </Link>
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}
