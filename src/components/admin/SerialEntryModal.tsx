'use client'

import { useState } from 'react'

export interface SerialItem {
  order_item_id: string
  product_name: string
  variant_name: string | null
  required_qty: number
  already_assigned: boolean
}

export interface SerialAssignment {
  order_item_id: string
  serial_number: string
}

interface Props {
  items: SerialItem[]
  onConfirm: (assignments: SerialAssignment[]) => void
  onCancel: () => void
}

export default function SerialEntryModal({ items, onConfirm, onCancel }: Props) {
  // Map of order_item_id → newline-separated serial input
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map(i => [i.order_item_id, '']))
  )

  function getSerials(itemId: string): string[] {
    return (inputs[itemId] || '').split('\n').map(s => s.trim()).filter(Boolean)
  }

  const canConfirm = items.every(item => {
    if (item.already_assigned) return true
    return getSerials(item.order_item_id).length === item.required_qty
  })

  function handleConfirm() {
    const assignments: SerialAssignment[] = []
    for (const item of items) {
      if (item.already_assigned) continue
      for (const sn of getSerials(item.order_item_id)) {
        assignments.push({ order_item_id: item.order_item_id, serial_number: sn })
      }
    }
    onConfirm(assignments)
  }

  const itemsNeedingEntry = items.filter(i => !i.already_assigned)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Enter Serial Numbers</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Scan or type the serial number(s) on the unit(s) being dispatched</p>
          </div>
          <button onClick={onCancel} className="text-foreground-muted hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {itemsNeedingEntry.map(item => {
            const entered = getSerials(item.order_item_id)
            const isOk = entered.length === item.required_qty
            const isOver = entered.length > item.required_qty
            return (
              <div key={item.order_item_id}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    {item.product_name}{item.variant_name ? ` / ${item.variant_name}` : ''}
                  </p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    isOver ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : isOk ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {entered.length} / {item.required_qty}
                  </span>
                </div>
                <textarea
                  rows={Math.min(6, Math.max(2, item.required_qty))}
                  placeholder={item.required_qty === 1 ? 'SN-0001' : 'SN-0001\nSN-0002\n...'}
                  className="w-full rounded-lg border border-border-default bg-surface text-foreground text-sm font-mono px-3 py-2 focus:outline-none focus:ring-2 focus:ring-secondary-500 resize-none"
                  value={inputs[item.order_item_id]}
                  onChange={e => setInputs(s => ({ ...s, [item.order_item_id]: e.target.value }))}
                />
                <p className="text-xs text-foreground-muted mt-1">One serial per line — need {item.required_qty}</p>
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
            Confirm Serials
          </button>
        </div>
      </div>
    </div>
  )
}
