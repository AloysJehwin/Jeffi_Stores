'use client'

import { useEffect, useState } from 'react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { ap } from '@/lib/admin-path'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  partial: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  ordered: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  received: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

type Tab = 'pos' | 'expenses' | 'products'
const VALID_TABS: Tab[] = ['pos', 'expenses', 'products']

export default function SupplierDetailClient({ id }: { id: string }) {
  const canFinancial = useHasScope('financial:read')
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const initialTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'pos'

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState<Tab>(initialTab)

  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(ap(`/admin/suppliers/${id}?${params.toString()}`), { scroll: false })
  }

  useEffect(() => {
    fetch(`/api/admin/suppliers/${id}`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (!loading && !data?.supplier) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Supplier not found.</p>
        {data?.error && <p className="text-red-500 text-xs mt-1 font-mono">{data.error}</p>}
        <Link href={ap('/admin/inventory?tab=suppliers')} className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Suppliers</Link>
      </div>
    )
  }

  if (loading || !data?.supplier) {
    return (
      <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
        {/* Breadcrumb */}
        <div className="h-4 w-40 bg-surface-secondary rounded animate-pulse" />
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-40 bg-surface-secondary rounded animate-pulse" />
          </div>
          <div className="h-8 w-28 bg-surface-secondary rounded-lg animate-pulse" />
        </div>
        {/* Info cards — 3-col grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="h-3 w-24 bg-surface-secondary rounded animate-pulse" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex justify-between gap-4 animate-pulse" style={{ animationDelay: `${j * 40}ms` }}>
                    <div className="h-3.5 w-20 bg-surface-secondary rounded shrink-0" />
                    <div className="h-3.5 bg-surface-secondary rounded flex-1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Tabs */}
        <div>
          <div className="flex gap-4 border-b border-border-default mb-4">
            <div className="h-8 w-40 bg-surface-secondary rounded animate-pulse" />
            <div className="h-8 w-44 bg-surface-secondary rounded animate-pulse" />
          </div>
          {/* Tab content table */}
          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4 animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="h-4 w-24 bg-surface-secondary rounded shrink-0" />
                  <div className="h-4 w-20 bg-surface-secondary rounded shrink-0" />
                  <div className="h-4 w-20 bg-surface-secondary rounded shrink-0" />
                  <div className="h-4 bg-surface-secondary rounded flex-1" />
                  <div className="h-4 w-16 bg-surface-secondary rounded shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const s = data.supplier
  const pos: any[] = data.pos || []
  const expenses: any[] = data.expenses || []
  const linkedProducts: any[] = data.linkedProducts || []
  const purchasedProducts: any[] = data.purchasedProducts || []

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap('/admin/inventory?tab=suppliers')} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Suppliers
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">{s.name || 'Supplier Detail'}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={ap('/admin/inventory')} className="text-foreground-secondary hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-foreground">{s.name}</h1>
          {!s.is_active && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-secondary text-foreground-secondary">Inactive</span>
          )}
        </div>
        <Link
          href={ap(`/admin/inventory?tab=suppliers`)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
        >
          All Suppliers
        </Link>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Contact */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Contact</p>
          <div className="space-y-1.5 text-sm">
            {s.contact_name && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Contact</span>
                <span className="text-foreground font-medium">{s.contact_name}</span>
              </div>
            )}
            {s.phone && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Phone</span>
                <a href={`tel:+91${s.phone}`} className="text-accent-500 hover:underline">+91 {s.phone}</a>
              </div>
            )}
            {s.email && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Email</span>
                <a href={`mailto:${s.email}`} className="text-accent-500 hover:underline text-xs">{s.email}</a>
              </div>
            )}
            {s.address && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary shrink-0">Address</span>
                <span className="text-foreground text-right text-xs">{s.address}</span>
              </div>
            )}
          </div>
        </div>

        {/* GST & Payment */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">GST & Payment</p>
          <div className="space-y-1.5 text-sm">
            {s.gstin && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">GSTIN</span>
                <span className="font-mono text-xs text-foreground">{s.gstin}</span>
              </div>
            )}
            {s.payment_terms && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Payment Terms</span>
                <span className="text-foreground">{s.payment_terms} days</span>
              </div>
            )}
            {s.bank_name && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Bank</span>
                <span className="text-foreground">{s.bank_name}</span>
              </div>
            )}
            {s.account_number && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Account</span>
                <span className="font-mono text-xs text-foreground">{s.account_number}</span>
              </div>
            )}
            {s.ifsc && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">IFSC</span>
                <span className="font-mono text-xs text-foreground">{s.ifsc}</span>
              </div>
            )}
            {s.upi_id && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">UPI</span>
                <span className="font-mono text-xs text-foreground">{s.upi_id}</span>
              </div>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Summary</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Total POs</span>
              <span className="font-semibold text-foreground">{s.po_count}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">PO Value</span>
              <span className="font-semibold text-foreground">{formatINR(parseFloat(s.po_total || '0'))}</span>
            </div>
            <div className="flex justify-between gap-4 pt-1 border-t border-border-default">
              <span className="text-foreground-secondary">Total Bills</span>
              <span className="font-semibold text-foreground">{s.expense_count}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Bills Value</span>
              <span className="font-semibold text-foreground">{formatINR(parseFloat(s.expense_total || '0'))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div className="flex border-b border-border-default mb-4">
          {(['pos', 'expenses', 'products'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-accent-500 text-accent-500'
                  : 'border-transparent text-foreground-secondary hover:text-foreground'
              }`}
            >
              {t === 'pos'
                ? `Purchase Orders (${pos.length})`
                : t === 'expenses'
                ? `Bills / Expenses (${expenses.length})`
                : `Products (${linkedProducts.length})`}
            </button>
          ))}
        </div>

        {tab === 'pos' && (
          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            {pos.length === 0 ? (
              <p className="text-foreground-secondary text-sm text-center py-8">No purchase orders found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">PO #</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Date</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Expected</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Status</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {pos.map((po: any) => (
                      <tr key={po.id} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={ap(`/admin/inventory?po=${po.po_number}`)} className="font-mono font-medium text-accent-500 hover:underline">
                            {po.po_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(po.order_date)}</td>
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(po.expected_date)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[po.status] || 'bg-surface-secondary text-foreground-secondary'}`}>
                            {po.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(po.total_amount || '0'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'expenses' && (
          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            {expenses.length === 0 ? (
              <p className="text-foreground-secondary text-sm text-center py-8">No bills/expenses found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Bill #</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">PO #</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Date</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Due</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Status</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {expenses.map((e: any) => (
                      <tr key={e.id} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="px-4 py-3">
                          {canFinancial ? (
                            <Link href={ap(`/admin/financial/payables/${e.id}`)} className="font-mono font-medium text-accent-500 hover:underline">
                              {e.expense_number}
                            </Link>
                          ) : (
                            <span className="font-mono font-medium text-foreground">{e.expense_number}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground-secondary font-mono text-xs">{e.po_number || '—'}</td>
                        <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(e.expense_date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`${new Date(e.due_date) < new Date() && e.status !== 'paid' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground-secondary'}`}>
                            {formatDate(e.due_date)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[e.status] || 'bg-surface-secondary text-foreground-secondary'}`}>
                            {e.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(e.total_amount || '0'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'products' && (
          <div className="space-y-6">
            {/* Linked — current buy-price list from product_suppliers */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Linked (buy-price list)</p>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                {linkedProducts.length === 0 ? (
                  <p className="text-foreground-secondary text-sm text-center py-8">No products linked to this supplier</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-secondary">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Product</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Variant / Sub-variant</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Buy Price</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Preferred</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">MOQ</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Lead (days)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {linkedProducts.map((p: any, i: number) => (
                          <tr key={`${p.product_id}-${p.variant_id || ''}-${p.sub_variant_id || ''}-${i}`} className="hover:bg-surface-secondary/40 transition-colors">
                            <td className="px-4 py-3">
                              <Link href={ap(`/admin/products/${p.product_id}`)} className="font-medium text-accent-500 hover:underline">{p.product_name}</Link>
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary">{p.sub_variant_name || p.variant_name || '—'}</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.unit_cost || '0'))}</td>
                            <td className="px-4 py-3 text-center">{p.is_preferred ? '★' : '—'}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary">{p.moq ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary">{p.lead_time_days ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Purchased — actuals from purchase order items */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-2">Purchased (from POs)</p>
              <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
                {purchasedProducts.length === 0 ? (
                  <p className="text-foreground-secondary text-sm text-center py-8">No purchases recorded from this supplier</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-secondary">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Product</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Variant</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Total Qty</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Last Unit Cost</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Last Ordered</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">POs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {purchasedProducts.map((p: any, i: number) => (
                          <tr key={`${p.product_id}-${p.variant_id || ''}-${i}`} className="hover:bg-surface-secondary/40 transition-colors">
                            <td className="px-4 py-3">
                              <Link href={ap(`/admin/products/${p.product_id}`)} className="font-medium text-accent-500 hover:underline">{p.product_name}</Link>
                            </td>
                            <td className="px-4 py-3 text-foreground-secondary">{p.sub_variant_name || p.variant_name || '—'}</td>
                            <td className="px-4 py-3 text-right text-foreground">{Number(p.total_qty || 0)}</td>
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.last_unit_cost || '0'))}</td>
                            <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(p.last_order_date)}</td>
                            <td className="px-4 py-3 text-right text-foreground-secondary">{p.po_count ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {s.notes && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-1.5">Notes</p>
          <p className="text-sm text-foreground">{s.notes}</p>
        </div>
      )}
    </div>
  )
}
