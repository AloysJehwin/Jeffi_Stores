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
  qty: number
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

// Per-item state: map of batch_id → qty allocated from that batch
type ItemSelections = Record<string, number>

function initSelections(item: BatchPickerItem): ItemSelections {
  const sel: ItemSelections = {}
  let remaining = item.required_qty
  for (const b of item.batches) {
    if (remaining <= 0) break
    const take = Math.min(b.quantity_remaining, remaining)
    if (take > 0) {
      sel[b.id] = take
      remaining -= take
    }
  }
  return sel
}

export default function BatchPickerModal({ items, onConfirm, onCancel }: Props) {
  const [selections, setSelections] = useState<Record<string, ItemSelections>>(() => {
    const init: Record<string, ItemSelections> = {}
    for (const item of items) {
      if (!item.already_assigned) init[item.order_item_id] = initSelections(item)
    }
    return init
  })

  const itemsNeedingSelection = items.filter(i => !i.already_assigned && i.batches.length > 0)
  const itemsWithNoBatches = items.filter(i => !i.already_assigned && i.batches.length === 0)

  function getAllocated(itemId: string) {
    return Object.values(selections[itemId] ?? {}).reduce((s, q) => s + q, 0)
  }

  function setQty(itemId: string, batchId: string, val: number, maxAvail: number) {
    setSelections(s => {
      const prev = { ...s[itemId] }
      if (val <= 0) {
        delete prev[batchId]
      } else {
        prev[batchId] = Math.min(val, maxAvail)
      }
      return { ...s, [itemId]: prev }
    })
  }

  function toggleBatch(itemId: string, batchId: string, maxAvail: number, required: number) {
    setSelections(s => {
      const prev = { ...(s[itemId] ?? {}) }
      if (prev[batchId]) {
        delete prev[batchId]
      } else {
        const alreadyAllocated = Object.values(prev).reduce((a, b) => a + b, 0)
        const still_needed = Math.max(0, required - alreadyAllocated)
        prev[batchId] = Math.min(maxAvail, still_needed > 0 ? still_needed : required)
      }
      return { ...s, [itemId]: prev }
    })
  }

  function handleConfirm() {
    const assignments: BatchAssignment[] = []
    for (const [order_item_id, batchQtys] of Object.entries(selections)) {
      for (const [batch_id, qty] of Object.entries(batchQtys)) {
        if (qty > 0) assignments.push({ order_item_id, batch_id, qty })
      }
    }
    onConfirm(assignments)
  }

  const canConfirm = itemsWithNoBatches.length === 0 && itemsNeedingSelection.every(item => {
    const allocated = getAllocated(item.order_item_id)
    return allocated >= item.required_qty
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Assign Batches</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Select one or more batches per item — quantities auto-filled (FIFO)</p>
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

          {itemsNeedingSelection.map(item => {
            const allocated = getAllocated(item.order_item_id)
            const isFullyAllocated = allocated >= item.required_qty
            const isOver = allocated > item.required_qty
            return (
              <div key={item.order_item_id}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-semibold text-foreground text-sm">
                      {item.product_name}{item.variant_name ? ` / ${item.variant_name}` : ''}
                    </p>
                    <p className="text-xs text-foreground-muted">Required: {item.required_qty} units</p>
                  </div>
                  <div className={`text-sm font-semibold px-2 py-0.5 rounded ${
                    isOver ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : isFullyAllocated ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {allocated} / {item.required_qty}
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
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Take</th>
                        <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {item.batches.map((batch, idx) => {
                        const isChecked = !!selections[item.order_item_id]?.[batch.id]
                        const qty = selections[item.order_item_id]?.[batch.id] ?? 0
                        return (
                          <tr
                            key={batch.id}
                            className={`transition-colors ${isChecked ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface cursor-pointer'}`}
                            onClick={() => toggleBatch(item.order_item_id, batch.id, batch.quantity_remaining, item.required_qty)}
                          >
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleBatch(item.order_item_id, batch.id, batch.quantity_remaining, item.required_qty)}
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
                                : <span className="text-foreground-muted">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-foreground">
                              {batch.quantity_remaining}
                              {batch.quantity_remaining < item.required_qty && (
                                <span className="ml-1 text-orange-500 text-[10px]">⚠ low</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              {isChecked ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setQty(item.order_item_id, batch.id, qty - 1, batch.quantity_remaining)}
                                    disabled={qty <= 1}
                                    className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                  >‹</button>
                                  <input
                                    type="number"
                                    min={1}
                                    max={batch.quantity_remaining}
                                    value={qty}
                                    onChange={e => {
                                      const v = parseInt(e.target.value)
                                      if (!isNaN(v)) setQty(item.order_item_id, batch.id, v, batch.quantity_remaining)
                                    }}
                                    className="w-12 text-center text-xs font-medium text-foreground tabular-nums border border-border-default rounded bg-surface px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setQty(item.order_item_id, batch.id, qty + 1, batch.quantity_remaining)}
                                    disabled={qty >= batch.quantity_remaining}
                                    className="w-6 h-6 flex items-center justify-center rounded border border-border-default bg-surface text-foreground hover:bg-surface-elevated disabled:opacity-30 text-xs font-bold transition-colors"
                                  >›</button>
                                </div>
                              ) : (
                                <span className="text-foreground-muted text-xs">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-foreground-muted">
                              {batch.location || <span>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {isOver && (
                  <p className="text-xs text-orange-600 mt-1">⚠ Allocated {allocated} exceeds required {item.required_qty} — reduce qty in one of the selected batches.</p>
                )}
              </div>
            )
          })}
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
