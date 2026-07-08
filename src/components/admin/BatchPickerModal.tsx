'use client'

import { useState } from 'react'

export interface BatchOption {
  id: string
  lot_number: string | null
  manufacture_date: string | null
  expiry_date: string | null
  quantity_remaining: number
  location: string | null
}

export interface BatchPickerItem {
  order_item_id: string
  product_name: string
  variant_name: string | null
  required_qty: number
  already_assigned: boolean
  batches: BatchOption[]
}

export interface BatchAssignment {
  order_item_id: string
  batch_id: string
}

interface Props {
  items: BatchPickerItem[]
  onConfirm: (assignments: BatchAssignment[]) => void
  onCancel: () => void
}

function expiryColor(expiryDate: string | null): string {
  if (!expiryDate) return 'text-foreground-muted'
  const days = Math.round((new Date(expiryDate).getTime() - Date.now()) / 86400000)
  if (days < 0) return 'text-red-500 font-semibold'
  if (days <= 7) return 'text-orange-500 font-semibold'
  if (days <= 30) return 'text-yellow-600 font-semibold'
  return 'text-green-600'
}

export default function BatchPickerModal({ items, onConfirm, onCancel }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const item of items) {
      if (!item.already_assigned && item.batches.length > 0) {
        init[item.order_item_id] = item.batches[0].id
      }
    }
    return init
  })

  const itemsNeedingSelection = items.filter(i => !i.already_assigned && i.batches.length > 0)
  const itemsWithNoBatches = items.filter(i => !i.already_assigned && i.batches.length === 0)

  function handleConfirm() {
    const assignments: BatchAssignment[] = Object.entries(selections).map(([order_item_id, batch_id]) => ({
      order_item_id,
      batch_id,
    }))
    onConfirm(assignments)
  }

  const canConfirm = itemsWithNoBatches.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Assign Batches</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Select batch for each perishable item (FIFO pre-selected)</p>
          </div>
          <button onClick={onCancel} className="text-foreground-muted hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
          {itemsWithNoBatches.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">No batches available for:</p>
              <ul className="text-sm text-red-600 dark:text-red-400 list-disc ml-4 space-y-0.5">
                {itemsWithNoBatches.map(i => (
                  <li key={i.order_item_id}>
                    {i.product_name}{i.variant_name ? ` / ${i.variant_name}` : ''} — requires {i.required_qty} units
                  </li>
                ))}
              </ul>
              <p className="text-xs text-red-500 mt-2">Receive stock via GRN before processing this order.</p>
            </div>
          )}

          {itemsNeedingSelection.map(item => (
            <div key={item.order_item_id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-foreground text-sm">
                    {item.product_name}{item.variant_name ? ` / ${item.variant_name}` : ''}
                  </p>
                  <p className="text-xs text-foreground-muted">Required: {item.required_qty} units</p>
                </div>
              </div>
              <div className="border border-border-default rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface border-b border-border-default">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-8"></th>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Lot</th>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Expiry</th>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Available</th>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {item.batches.map((batch, idx) => (
                      <tr
                        key={batch.id}
                        className={`cursor-pointer hover:bg-surface transition-colors ${selections[item.order_item_id] === batch.id ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
                        onClick={() => setSelections(s => ({ ...s, [item.order_item_id]: batch.id }))}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="radio"
                            name={`batch-${item.order_item_id}`}
                            checked={selections[item.order_item_id] === batch.id}
                            onChange={() => setSelections(s => ({ ...s, [item.order_item_id]: batch.id }))}
                            className="accent-accent-500"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                          {batch.lot_number || <span className="text-foreground-muted">—</span>}
                          {idx === 0 && <span className="ml-1.5 text-[10px] bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400 px-1.5 py-0.5 rounded font-medium">FIFO</span>}
                        </td>
                        <td className={`px-3 py-2.5 text-xs ${expiryColor(batch.expiry_date)}`}>
                          {batch.expiry_date
                            ? new Date(batch.expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            : <span className="text-foreground-muted">—</span>
                          }
                        </td>
                        <td className="px-3 py-2.5 text-xs text-foreground">
                          {batch.quantity_remaining}
                          {batch.quantity_remaining < item.required_qty && (
                            <span className="ml-1 text-orange-500 text-[10px]">⚠ low</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">
                          {batch.location || <span>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border-default flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground border border-border-default rounded-lg hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Confirm Batch Assignment
          </button>
        </div>
      </div>
    </div>
  )
}
