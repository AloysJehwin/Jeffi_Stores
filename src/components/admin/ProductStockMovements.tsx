'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'

interface Transaction {
  id: string
  created_at: string
  transaction_type: 'purchase' | 'sale' | 'return' | 'adjustment'
  quantity_change: number
  quantity_after: number | null
  reference_type: string | null
  reference_id: string | null
  reference_label: string | null
  notes: string | null
  variant_name: string | null
  serial_number: string | null
  lot_number: string | null
  expiry_date: string | null
}

const TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  sale: 'Sale',
  return: 'Return',
  adjustment: 'Adjustment',
}

const TYPE_COLORS: Record<string, string> = {
  purchase: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
  sale: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  return: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
  adjustment: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20',
}

export default function ProductStockMovements({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const PAGE_SIZE = 20

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const params = new URLSearchParams({
      view: 'ledger',
      product_id: productId,
      page: String(page),
      limit: String(PAGE_SIZE),
    })
    fetch(`/api/admin/inventory/stock?${params}`)
      .then(r => r.json())
      .then(d => {
        setRows(d.transactions || [])
        setTotal(d.total || 0)
      })
      .finally(() => setLoading(false))
  }, [open, productId, page])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="mt-6 border border-border-default rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-surface-secondary transition-colors text-sm font-semibold text-foreground"
      >
        <span>Stock Movements</span>
        <span className="text-foreground-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-foreground-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-foreground-muted">No stock movements recorded.</div>
          ) : (
            <>
              <table className="min-w-full text-sm">
                <thead className="bg-surface-secondary border-b border-border-default">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">Variant</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-foreground-secondary">Qty Change</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-foreground-secondary">Stock After</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">Reference</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">
                      Batch / Serial
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-foreground-secondary">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {rows.map(tx => (
                    <tr key={tx.id} className="hover:bg-surface-secondary/50 transition-colors">
                      <td className="px-4 py-2 whitespace-nowrap text-foreground-secondary">
                        <div>
                          {new Date(tx.created_at).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[11px] text-foreground-muted">
                          {new Date(tx.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[tx.transaction_type] || 'bg-surface-secondary text-foreground-secondary'}`}
                        >
                          {TYPE_LABELS[tx.transaction_type] || tx.transaction_type}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-foreground-secondary">{tx.variant_name || '—'}</td>
                      <td
                        className={`px-4 py-2 text-right font-mono font-medium ${tx.quantity_change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {tx.quantity_change > 0 ? '+' : ''}
                        {tx.quantity_change}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-foreground-secondary">
                        {tx.quantity_after ?? '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {tx.reference_type === 'order' && tx.reference_id ? (
                          <Link
                            href={ap(`/admin/orders/${tx.reference_id}`)}
                            className="text-accent-500 hover:text-accent-600 hover:underline underline-offset-2 font-medium"
                          >
                            {tx.reference_label || 'Order'}
                          </Link>
                        ) : tx.reference_type === 'cash_sale' && tx.reference_id ? (
                          <span className="text-foreground-secondary font-medium">
                            {tx.reference_label || 'Cash Sale'}
                          </span>
                        ) : tx.reference_type === 'grn' ? (
                          <span className="text-foreground-secondary font-medium">{tx.reference_label || 'GRN'}</span>
                        ) : tx.reference_type ? (
                          <span className="text-foreground-secondary capitalize">
                            {tx.reference_type.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-foreground-secondary">
                        {tx.serial_number ? (
                          <span className="font-mono text-xs">{tx.serial_number}</span>
                        ) : tx.lot_number ? (
                          <div>
                            <span className="font-mono text-xs">{tx.lot_number}</span>
                            {tx.expiry_date && (
                              <div className="text-[11px] text-foreground-muted">
                                Exp:{' '}
                                {new Date(tx.expiry_date).toLocaleDateString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-foreground-secondary max-w-[200px] truncate">{tx.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border-default bg-surface text-sm">
                  <span className="text-foreground-secondary">{total} movements</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1 rounded border border-border-secondary text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
                    >
                      Prev
                    </button>
                    <span className="px-2 py-1 text-foreground-secondary">
                      {page} / {pages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(pages, p + 1))}
                      disabled={page === pages}
                      className="px-3 py-1 rounded border border-border-secondary text-foreground-secondary disabled:opacity-40 hover:bg-surface-secondary transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
