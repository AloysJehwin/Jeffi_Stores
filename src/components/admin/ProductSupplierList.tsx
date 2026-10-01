'use client'

import { useMemo } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { Trash2, Plus, Star } from 'lucide-react'

export interface SupplierRow {
  supplier_id: string
  unit_cost: string
  is_preferred: boolean
  moq?: string
  lead_time_days?: string
  notes?: string
  currency?: string
}

interface Props {
  suppliers: { id: string; name: string }[] // master supplier list
  value: SupplierRow[]
  onChange: (rows: SupplierRow[]) => void
  note?: string
}

export function emptySupplierRow(): SupplierRow {
  return {
    supplier_id: '',
    unit_cost: '',
    is_preferred: false,
    moq: '',
    lead_time_days: '',
    notes: '',
    currency: 'INR',
  }
}

export default function ProductSupplierList({ suppliers, value, onChange, note }: Props) {
  const rows = value

  // Index of the cheapest row with a valid price → highlighted as "best price".
  const bestIdx = useMemo(() => {
    let idx = -1
    let min = Infinity
    rows.forEach((r, i) => {
      const c = parseFloat(r.unit_cost)
      if (Number.isFinite(c) && c >= 0 && c < min) {
        min = c
        idx = i
      }
    })
    return idx
  }, [rows])

  const update = (i: number, patch: Partial<SupplierRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange(next)
  }

  const setPreferred = (i: number) => {
    onChange(rows.map((r, idx) => ({ ...r, is_preferred: idx === i })))
  }

  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  const add = () => onChange([...rows, emptySupplierRow()])

  // Suppliers already chosen (to disable duplicates in each row's dropdown).
  const chosen = new Set(rows.map(r => r.supplier_id).filter(Boolean))

  return (
    <div>
      <label className="block text-sm font-medium text-foreground-secondary mb-2">Suppliers &amp; Prices</label>

      {rows.length === 0 ? (
        <p className="text-xs text-foreground-muted mb-2">
          No suppliers linked yet. Add the suppliers this product is sourced from and the price each quotes.
        </p>
      ) : (
        <div className="space-y-2 mb-2">
          {rows.map((row, i) => {
            const isBest = i === bestIdx && parseFloat(row.unit_cost) >= 0 && row.unit_cost !== ''
            return (
              <div
                key={i}
                className={`rounded-lg border p-2 ${isBest ? 'border-accent-400 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface'}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[160px]">
                    <AdminSelect
                      sm
                      value={row.supplier_id}
                      placeholder="Select supplier"
                      onChange={v => update(i, { supplier_id: v })}
                      options={[
                        { value: '', label: 'Select supplier' },
                        ...suppliers.map(s => ({
                          value: s.id,
                          // keep the current row's own supplier selectable; hide others already chosen
                          label: chosen.has(s.id) && s.id !== row.supplier_id ? `${s.name} (added)` : s.name,
                        })),
                      ]}
                    />
                  </div>
                  <div className="w-28">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.unit_cost}
                        onChange={e => update(i, { unit_cost: e.target.value })}
                        placeholder="Buy price"
                        className="w-full pl-5 pr-2 py-1.5 text-sm rounded border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreferred(i)}
                    title={row.is_preferred ? 'Preferred supplier' : 'Set as preferred'}
                    className={`p-1.5 rounded border transition-colors ${row.is_preferred ? 'border-amber-400 text-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-border-secondary text-foreground-muted hover:text-amber-500'}`}
                  >
                    <Star className="w-4 h-4" fill={row.is_preferred ? 'currentColor' : 'none'} />
                  </button>
                  {isBest && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
                      Best price
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    title="Remove supplier"
                    className="p-1.5 rounded border border-border-secondary text-foreground-muted hover:text-red-500 hover:border-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 pl-0.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.moq || ''}
                    onChange={e => update(i, { moq: e.target.value })}
                    placeholder="MOQ"
                    className="w-24 px-2 py-1 text-xs rounded border border-border-secondary bg-surface text-foreground"
                  />
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={row.lead_time_days || ''}
                    onChange={e => update(i, { lead_time_days: e.target.value })}
                    placeholder="Lead days"
                    className="w-24 px-2 py-1 text-xs rounded border border-border-secondary bg-surface text-foreground"
                  />
                  <input
                    type="text"
                    value={row.notes || ''}
                    onChange={e => update(i, { notes: e.target.value })}
                    placeholder="Notes"
                    className="flex-1 min-w-[100px] px-2 py-1 text-xs rounded border border-border-secondary bg-surface text-foreground"
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 text-sm text-accent-600 hover:text-accent-700 font-medium"
      >
        <Plus className="w-4 h-4" /> Add supplier
      </button>
      <p className="text-xs text-foreground-muted mt-1">
        {note ??
          'Product-level — inherited by all variants. The lowest price is highlighted; ★ marks your preferred supplier.'}
      </p>
    </div>
  )
}
