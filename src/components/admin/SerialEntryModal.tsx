'use client'

import { useState, useEffect } from 'react'

export interface SerialItem {
  order_item_id: string
  product_name: string
  variant_name: string | null
  required_qty: number
  already_assigned: boolean
  // optional — used to fetch available serials
  product_id?: string
  variant_id?: string | null
  sub_variant_id?: string | null
}

export interface SerialAssignment {
  order_item_id: string
  serial_number: string
}

interface AvailableSerial {
  serial_number: string
  batch_id: string | null
  lot_number: string | null
}

interface Props {
  items: SerialItem[]
  onConfirm: (assignments: SerialAssignment[]) => void
  onCancel: () => void
}

function SerialPicker({
  item,
  selected,
  onChange,
}: {
  item: SerialItem
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [available, setAvailable] = useState<AvailableSerial[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!item.product_id) return
    setLoading(true)
    const params = new URLSearchParams({ product_id: item.product_id })
    if (item.variant_id) params.set('variant_id', item.variant_id)
    if (item.sub_variant_id) params.set('sub_variant_id', item.sub_variant_id)
    fetch(`/api/admin/inventory/serials/available?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const list: AvailableSerial[] = data.serials || []
        setAvailable(list)
        // Auto-select first N
        const autoSelected = new Set(list.slice(0, item.required_qty).map(s => s.serial_number))
        onChange(autoSelected)
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.product_id, item.variant_id, item.sub_variant_id])

  function toggle(sn: string) {
    const next = new Set(selected)
    if (next.has(sn)) {
      next.delete(sn)
    } else {
      if (next.size >= item.required_qty) return
      next.add(sn)
    }
    onChange(next)
  }

  function toggleBatch(lotKey: string) {
    setCollapsedBatches(prev => {
      const next = new Set(prev)
      if (next.has(lotKey)) next.delete(lotKey)
      else next.add(lotKey)
      return next
    })
  }

  // Group by lot_number (null lot = "No Lot")
  const filtered = search
    ? available.filter(s =>
        s.serial_number.toLowerCase().includes(search.toLowerCase()) ||
        (s.lot_number || '').toLowerCase().includes(search.toLowerCase())
      )
    : available

  const batches: { lotKey: string; lotLabel: string; serials: AvailableSerial[] }[] = []
  for (const s of filtered) {
    const lotKey = s.lot_number || '__no_lot__'
    const lotLabel = s.lot_number || 'No Lot'
    const existing = batches.find(b => b.lotKey === lotKey)
    if (existing) existing.serials.push(s)
    else batches.push({ lotKey, lotLabel, serials: [s] })
  }

  const isOk = selected.size === item.required_qty
  const isOver = selected.size > item.required_qty

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-foreground">
          {item.product_name}{item.variant_name ? ` / ${item.variant_name}` : ''}
        </p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
          isOver  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          : isOk  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {selected.size} / {item.required_qty} selected
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-foreground-muted py-4 text-center">Loading serials…</div>
      ) : available.length === 0 ? (
        <div className="text-xs text-red-500 py-3 text-center">No in-stock serials found for this product</div>
      ) : (
        <>
          {available.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter serials or lot…"
              className="w-full mb-2 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-secondary-500 font-mono"
            />
          )}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border-default">
            {batches.map(batch => {
              const collapsed = collapsedBatches.has(batch.lotKey)
              const batchSelected = batch.serials.filter(s => selected.has(s.serial_number)).length
              return (
                <div key={batch.lotKey}>
                  {/* Batch header */}
                  <button
                    type="button"
                    onClick={() => toggleBatch(batch.lotKey)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-surface-secondary hover:bg-surface-secondary/80 transition-colors text-left border-b border-border-default"
                  >
                    <div className="flex items-center gap-2">
                      <svg className={`w-3 h-3 text-foreground-muted transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      <span className="text-xs font-semibold text-foreground">{batch.lotLabel}</span>
                      <span className="text-xs text-foreground-muted">{batch.serials.length} serial{batch.serials.length !== 1 ? 's' : ''}</span>
                    </div>
                    {batchSelected > 0 && (
                      <span className="text-xs font-semibold text-secondary-600 dark:text-secondary-400">{batchSelected} selected</span>
                    )}
                  </button>
                  {/* Serials */}
                  {!collapsed && batch.serials.map(s => {
                    const checked = selected.has(s.serial_number)
                    const disabled = !checked && selected.size >= item.required_qty
                    return (
                      <label
                        key={s.serial_number}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-b border-border-default last:border-0 ${
                          checked ? 'bg-secondary-50 dark:bg-secondary-900/20' : disabled ? 'opacity-40' : 'hover:bg-surface-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(s.serial_number)}
                          className="accent-secondary-500 shrink-0"
                        />
                        <span className="text-sm font-mono text-foreground flex-1">{s.serial_number}</span>
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-foreground-muted mt-1.5">
            {available.length} serial{available.length !== 1 ? 's' : ''} in stock across {batches.length} batch{batches.length !== 1 ? 'es' : ''} — select exactly {item.required_qty}
          </p>
        </>
      )}
    </div>
  )
}

export default function SerialEntryModal({ items, onConfirm, onCancel }: Props) {
  const itemsNeedingEntry = items.filter(i => !i.already_assigned)

  const [selections, setSelections] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(itemsNeedingEntry.map(i => [i.order_item_id, new Set<string>()]))
  )

  const canConfirm = itemsNeedingEntry.every(item =>
    selections[item.order_item_id]?.size === item.required_qty
  )

  function handleConfirm() {
    const assignments: SerialAssignment[] = []
    for (const item of itemsNeedingEntry) {
      for (const sn of selections[item.order_item_id] || []) {
        assignments.push({ order_item_id: item.order_item_id, serial_number: sn })
      }
    }
    onConfirm(assignments)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Select Serial Numbers</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Serials grouped by batch — top {itemsNeedingEntry[0]?.required_qty ?? 'N'} pre-selected</p>
          </div>
          <button onClick={onCancel} className="text-foreground-muted hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
          {itemsNeedingEntry.map(item => (
            <SerialPicker
              key={item.order_item_id}
              item={item}
              selected={selections[item.order_item_id] || new Set()}
              onChange={next => setSelections(s => ({ ...s, [item.order_item_id]: next }))}
            />
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
            Confirm Serials
          </button>
        </div>
      </div>
    </div>
  )
}


import { useState, useEffect } from 'react'

export interface SerialItem {
  order_item_id: string
  product_name: string
  variant_name: string | null
  required_qty: number
  already_assigned: boolean
  // optional — used to fetch available serials
  product_id?: string
  variant_id?: string | null
  sub_variant_id?: string | null
}

export interface SerialAssignment {
  order_item_id: string
  serial_number: string
}

interface AvailableSerial {
  serial_number: string
  batch_id: string | null
  lot_number: string | null
}

interface Props {
  items: SerialItem[]
  onConfirm: (assignments: SerialAssignment[]) => void
  onCancel: () => void
}

function SerialPicker({
  item,
  selected,
  onChange,
}: {
  item: SerialItem
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [available, setAvailable] = useState<AvailableSerial[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!item.product_id) return
    setLoading(true)
    const params = new URLSearchParams({ product_id: item.product_id })
    if (item.variant_id) params.set('variant_id', item.variant_id)
    if (item.sub_variant_id) params.set('sub_variant_id', item.sub_variant_id)
    fetch(`/api/admin/inventory/serials/available?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const list: AvailableSerial[] = data.serials || []
        setAvailable(list)
        // Auto-select first N
        const autoSelected = new Set(list.slice(0, item.required_qty).map(s => s.serial_number))
        onChange(autoSelected)
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.product_id, item.variant_id, item.sub_variant_id])

  function toggle(sn: string) {
    const next = new Set(selected)
    if (next.has(sn)) {
      next.delete(sn)
    } else {
      if (next.size >= item.required_qty) return // don't exceed required
      next.add(sn)
    }
    onChange(next)
  }

  const filtered = search
    ? available.filter(s => s.serial_number.toLowerCase().includes(search.toLowerCase()) || (s.lot_number || '').toLowerCase().includes(search.toLowerCase()))
    : available

  const isOk = selected.size === item.required_qty
  const isOver = selected.size > item.required_qty

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-foreground">
          {item.product_name}{item.variant_name ? ` / ${item.variant_name}` : ''}
        </p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
          isOver  ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          : isOk  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {selected.size} / {item.required_qty} selected
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-foreground-muted py-4 text-center">Loading serials…</div>
      ) : available.length === 0 ? (
        <div className="text-xs text-red-500 py-3 text-center">No in-stock serials found for this product</div>
      ) : (
        <>
          {available.length > 8 && (
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter serials…"
              className="w-full mb-2 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-secondary-500 font-mono"
            />
          )}
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border-default divide-y divide-border-default">
            {filtered.map(s => {
              const checked = selected.has(s.serial_number)
              const disabled = !checked && selected.size >= item.required_qty
              return (
                <label
                  key={s.serial_number}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                    checked ? 'bg-secondary-50 dark:bg-secondary-900/20' : disabled ? 'opacity-40' : 'hover:bg-surface-secondary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(s.serial_number)}
                    className="accent-secondary-500 shrink-0"
                  />
                  <span className="text-sm font-mono text-foreground flex-1">{s.serial_number}</span>
                  {s.lot_number && (
                    <span className="text-xs text-foreground-muted shrink-0">Lot: {s.lot_number}</span>
                  )}
                </label>
              )
            })}
          </div>
          <p className="text-xs text-foreground-muted mt-1.5">
            {available.length} serial{available.length !== 1 ? 's' : ''} in stock — select exactly {item.required_qty}
          </p>
        </>
      )}
    </div>
  )
}

export default function SerialEntryModal({ items, onConfirm, onCancel }: Props) {
  const itemsNeedingEntry = items.filter(i => !i.already_assigned)

  // Map of order_item_id → Set of selected serial numbers
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(itemsNeedingEntry.map(i => [i.order_item_id, new Set<string>()]))
  )

  const canConfirm = itemsNeedingEntry.every(item =>
    selections[item.order_item_id]?.size === item.required_qty
  )

  function handleConfirm() {
    const assignments: SerialAssignment[] = []
    for (const item of itemsNeedingEntry) {
      for (const sn of selections[item.order_item_id] || []) {
        assignments.push({ order_item_id: item.order_item_id, serial_number: sn })
      }
    }
    onConfirm(assignments)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-elevated rounded-xl shadow-xl border border-border-default w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Select Serial Numbers</h2>
            <p className="text-sm text-foreground-muted mt-0.5">Confirm the units being dispatched — top {itemsNeedingEntry[0]?.required_qty ?? 'N'} pre-selected</p>
          </div>
          <button onClick={onCancel} className="text-foreground-muted hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
          {itemsNeedingEntry.map(item => (
            <SerialPicker
              key={item.order_item_id}
              item={item}
              selected={selections[item.order_item_id] || new Set()}
              onChange={next => setSelections(s => ({ ...s, [item.order_item_id]: next }))}
            />
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
            Confirm Serials
          </button>
        </div>
      </div>
    </div>
  )
}
