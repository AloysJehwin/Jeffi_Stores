'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import AdminTypeahead from '@/components/admin/AdminTypeahead'
import AdminSelect from '@/components/admin/AdminSelect'

export interface Warehouse {
  id: string
  name: string
  code: string
  address: string | null
  is_active: boolean
}

export interface ShelfLocation {
  id: string
  warehouse_id: string
  warehouse_name: string
  warehouse_code: string
  aisle_code: string
  rack_code: string
  shelf_code: string
  bin_code: string | null
  display_code: string
  notes: string | null
  is_active: boolean
  stock_count: number
}

export interface ShelfStock {
  id: string
  location_id: string
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  quantity: number
  updated_at: string
  product_name: string
  variant_name: string | null
  sku: string
  unit_label?: string | null
  unit_factor?: number | null
  unit_dimension?: string | null
}

const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const inputCls = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
const btnPrimary = 'flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-2 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors disabled:opacity-50'

export function WarehouseForm({ onSave, onCancel, initial }: {
  onSave: (data: { name: string; code: string; address: string }) => Promise<void>
  onCancel: () => void
  initial?: Partial<Warehouse>
}) {
  const [name, setName] = useState(initial?.name || '')
  const [code, setCode] = useState(initial?.code || '')
  const [address, setAddress] = useState(initial?.address || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) { setErr('Name and code required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ name: name.trim(), code: code.trim(), address: address.trim() })
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {err && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
      )}
      <div>
        <label className={labelCls}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Main Store" />
      </div>
      <div>
        <label className={labelCls}>Code (short ID)</label>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className={inputCls + ' font-mono'} placeholder="WH1" maxLength={10} />
      </div>
      <div>
        <label className={labelCls}>Address (optional)</label>
        <textarea value={address} onChange={e => setAddress(e.target.value)} className={inputCls} rows={2} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  )
}

export function LocationForm({ warehouseId, onSave, onCancel, initial }: {
  warehouseId: string
  onSave: (data: { aisle_code: string; rack_code: string; shelf_code: string; bin_code: string; notes: string }) => Promise<void>
  onCancel: () => void
  initial?: Partial<ShelfLocation>
}) {
  const [aisle, setAisle] = useState(initial?.aisle_code || '')
  const [rack, setRack] = useState(initial?.rack_code || '')
  const [shelf, setShelf] = useState(initial?.shelf_code || '')
  const [bin, setBin] = useState(initial?.bin_code || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!aisle.trim() || !rack.trim() || !shelf.trim()) { setErr('Aisle, rack and shelf required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ aisle_code: aisle.trim(), rack_code: rack.trim(), shelf_code: shelf.trim(), bin_code: bin.trim(), notes: notes.trim() })
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {err && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Aisle</label>
          <input value={aisle} onChange={e => setAisle(e.target.value)} className={inputCls + ' font-mono'} placeholder="A" maxLength={10} />
        </div>
        <div>
          <label className={labelCls}>Rack</label>
          <input value={rack} onChange={e => setRack(e.target.value)} className={inputCls + ' font-mono'} placeholder="01" maxLength={10} />
        </div>
        <div>
          <label className={labelCls}>Shelf</label>
          <input value={shelf} onChange={e => setShelf(e.target.value)} className={inputCls + ' font-mono'} placeholder="C" maxLength={10} />
        </div>
        <div>
          <label className={labelCls}>Bin (optional)</label>
          <input value={bin} onChange={e => setBin(e.target.value)} className={inputCls + ' font-mono'} placeholder="02" maxLength={10} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Notes (optional)</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="e.g. Fragile items only" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className={btnPrimary}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  )
}

export function StockRow({ row, locationId, siblingLocations, onRefresh }: {
  row: ShelfStock
  locationId: string
  siblingLocations: ShelfLocation[]
  onRefresh: () => void
}) {
  const factor = Number(row.unit_factor) || 1
  const isContinuous = ['length', 'weight', 'area', 'volume'].includes(row.unit_dimension ?? '')
  const unitLabel = row.unit_label || 'unit'

  function toSell(baseQty: number): string {
    const v = baseQty / factor
    return isContinuous ? v.toFixed(3) : String(Math.floor(v))
  }
  function toBase(sellQty: number): number {
    return Math.round(sellQty * factor)
  }

  const [editing, setEditing] = useState(false)
  const [newQty, setNewQty] = useState(toSell(row.quantity))
  const [moving, setMoving] = useState(false)
  const [destId, setDestId] = useState('')
  const [moveQty, setMoveQty] = useState(toSell(Math.min(factor, row.quantity)))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function saveQty() {
    const newBase = toBase(isContinuous ? parseFloat(newQty) : parseInt(newQty))
    const diff = newBase - row.quantity
    if (diff === 0) { setEditing(false); return }
    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/admin/shelving/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, product_id: row.product_id, variant_id: row.variant_id, sub_variant_id: row.sub_variant_id, quantity_change: diff, reason: 'adjustment' }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setEditing(false); onRefresh()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  async function doMove() {
    if (!destId) { setErr('Select destination'); return }
    const sellVal = isContinuous ? parseFloat(moveQty) : parseInt(moveQty)
    if (!sellVal || sellVal <= 0) { setErr('Enter valid quantity'); return }
    const qty = toBase(sellVal)
    if (qty <= 0) { setErr('Enter valid quantity'); return }
    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/admin/shelving/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', from_location_id: locationId, to_location_id: destId, product_id: row.product_id, variant_id: row.variant_id, sub_variant_id: row.sub_variant_id, quantity: qty }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setMoving(false); onRefresh()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const displayQty = toSell(row.quantity)
  const maxSellQty = toSell(row.quantity)
  const unitStep = isContinuous ? (factor < 1 ? factor : 0.001) : 1

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{row.product_name}</p>
          {row.variant_name && <p className="text-xs text-foreground-secondary truncate mt-0.5">{row.variant_name}</p>}
          <p className="text-xs font-mono text-foreground-muted mt-0.5">{row.sku}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={newQty}
                onChange={e => setNewQty(e.target.value)}
                min={unitStep}
                step={unitStep}
                max={undefined}
                className="w-20 px-2 py-1 rounded-lg border border-border-default bg-surface text-foreground text-sm text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent"
              />
              <span className="text-xs text-foreground-muted">{unitLabel}</span>
              <button onClick={saveQty} disabled={saving} aria-label="Save" className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => setEditing(false)} aria-label="Cancel" className="w-7 h-7 flex items-center justify-center rounded-lg border border-border-default hover:bg-surface-secondary text-foreground-secondary transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => { setNewQty(displayQty); setEditing(true) }}
              className="text-sm font-bold tabular-nums text-foreground hover:text-secondary-500 dark:hover:text-secondary-400 transition-colors min-w-[2rem] text-right"
            >
              {displayQty} <span className="text-xs font-normal text-foreground-muted">{unitLabel}</span>
            </button>
          )}
          <button
            onClick={() => setMoving(!moving)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors"
          >
            Move
          </button>
        </div>
      </div>
      {err && (
        <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
      )}
      {moving && (
        <div className="mt-3 pt-3 border-t border-border-default flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-32">
            <label className={labelCls}>To location</label>
            <AdminSelect
              options={[
                { value: '', label: 'Select…' },
                ...siblingLocations.filter(l => l.id !== locationId).map(l => ({ value: l.id, label: l.display_code })),
              ]}
              value={destId}
              onChange={v => setDestId(v)}
              placeholder="Select…"
              sm
            />
          </div>
          <div className="w-24">
            <label className={labelCls}>Qty ({unitLabel})</label>
            <input
              type="number"
              value={moveQty}
              onChange={e => setMoveQty(e.target.value)}
              className="w-full px-2 py-2 rounded-lg border border-border-default bg-surface text-foreground text-xs text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors"
              min={unitStep}
              step={unitStep}
              max={Number(maxSellQty)}
            />
          </div>
          <button
            onClick={doMove}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50"
          >
            {saving ? '…' : 'Move'}
          </button>
          <button
            onClick={() => setMoving(false)}
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export function AssignStockForm({ location, onSave, onCancel }: {
  location: ShelfLocation
  onSave: () => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{
    productId: string; variantId: string | null; subVariantId: string | null
    label: string
    inventoryQty: number    // in base units
    unallocatedQty: number | null  // in base units
    unitLabel: string; unitFactor: number; unitStep: number; isContinuous: boolean
  } | null>(null)
  const [qty, setQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [loadingAvail, setLoadingAvail] = useState(false)
  const [err, setErr] = useState('')

  async function handleSelect(item: { id: string; label: string }) {
    const parts = item.id.split('\x1f')
    const rawId = parts[0]
    let productId = '', variantId: string | null = null, subVariantId: string | null = null
    if (rawId.startsWith('product:')) productId = rawId.slice(8)
    else if (rawId.startsWith('variant:')) { variantId = rawId.slice(8); productId = '' }
    else if (rawId.startsWith('subvariant:')) { subVariantId = rawId.slice(11); productId = '' }
    const inventoryQty = parseInt(parts[11] || '0') || 0  // base units
    const resolvedProductId = parts[12] || productId

    setSelected({
      productId, variantId, subVariantId, label: item.label,
      inventoryQty, unallocatedQty: null,
      unitLabel: 'unit', unitFactor: 1, unitStep: 1, isContinuous: false
    })
    setQuery(item.label)
    setErr('')
    setQty('1')

    setLoadingAvail(true)
    try {
      const [shelfRes, unitRes] = await Promise.all([
        fetch(`/api/admin/shelving/stock?${new URLSearchParams({
          ...(productId ? { product_id: productId } : {}),
          ...(variantId ? { variant_id: variantId } : {}),
          ...(subVariantId ? { sub_variant_id: subVariantId } : {}),
        })}`),
        resolvedProductId
          ? fetch(`/api/admin/products/${resolvedProductId}/units${variantId ? `?variant_id=${variantId}` : ''}`)
          : null,
      ])

      let shelfTotal = 0  // base units
      if (shelfRes.ok) {
        const data = await shelfRes.json()
        shelfTotal = (data.locations || []).reduce((s: number, l: { quantity: number }) => s + (l.quantity || 0), 0)
      }

      let unitLabel = 'unit', unitFactor = 1, unitStep = 1, isContinuous = false
      if (unitRes?.ok) {
        const udata = await unitRes.json()
        const units: { unit: string; display_label: string | null; factor: number; dimension: string; is_base: boolean; id: string }[] = udata.units || []
        const sellUnitId = parts[13]
        const sellUnit = sellUnitId ? units.find(u => u.id === sellUnitId) : units.find(u => u.is_base)
        if (sellUnit) {
          unitLabel = sellUnit.display_label || sellUnit.unit
          unitFactor = Number(sellUnit.factor) || 1
          isContinuous = ['length', 'weight', 'area', 'volume'].includes(sellUnit.dimension)
          unitStep = isContinuous ? (unitFactor < 1 ? unitFactor : 0.001) : 1
        }
      }

      const unallocatedBase = Math.max(0, inventoryQty - shelfTotal)
      setSelected(s => s ? { ...s, unallocatedQty: unallocatedBase, unitLabel, unitFactor, unitStep, isContinuous } : s)
      // Default qty = 1 sell unit
      setQty(isContinuous ? unitStep.toFixed(3) : '1')
    } catch { /* non-critical */ } finally {
      setLoadingAvail(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) { setErr('Select a product first'); return }
    // qty entered in sell units — convert to base units for API
    const qtyInSellUnits = selected.isContinuous ? parseFloat(qty) : parseInt(qty)
    if (!qtyInSellUnits || qtyInSellUnits <= 0) { setErr('Enter valid quantity'); return }
    const qtyInBaseUnits = Math.round(qtyInSellUnits * selected.unitFactor)
    if (selected.unallocatedQty !== null && qtyInBaseUnits > selected.unallocatedQty) {
      const maxSellUnits = toSellUnits(selected.unallocatedQty, selected.unitFactor, selected.isContinuous)
      setErr(`Only ${maxSellUnits} ${selected.unitLabel}(s) unallocated`); return
    }
    setSaving(true); setErr('')
    try {
      const res = await fetch('/api/admin/shelving/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: location.id,
          product_id: selected.productId || '',
          variant_id: selected.variantId,
          sub_variant_id: selected.subVariantId,
          quantity_change: qtyInBaseUnits,
          reason: 'assign',
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      onSave()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  function toSellUnits(baseQty: number, factor: number, continuous: boolean): number | string {
    const v = baseQty / factor
    return continuous ? v.toFixed(3) : Math.floor(v)
  }

  const unallocatedBase = selected?.unallocatedQty ?? null
  const factor = selected?.unitFactor ?? 1
  const isContinuous = selected?.isContinuous ?? false
  const inventoryBase = selected?.inventoryQty ?? 0
  const allocatedBase = unallocatedBase !== null ? inventoryBase - unallocatedBase : null

  // Display values in sell units
  const inventoryDisplay = toSellUnits(inventoryBase, factor, isContinuous)
  const allocatedDisplay = allocatedBase !== null ? toSellUnits(allocatedBase, factor, isContinuous) : null
  const unallocatedDisplay = unallocatedBase !== null ? toSellUnits(unallocatedBase, factor, isContinuous) : null
  const maxQtyInSellUnits = unallocatedBase !== null ? Number(toSellUnits(unallocatedBase, factor, isContinuous)) : undefined

  const unitLabel = selected?.unitLabel ?? 'unit'
  const fillPct = inventoryBase > 0 && allocatedBase !== null ? Math.round((allocatedBase / inventoryBase) * 100) : 0

  return (
    <form onSubmit={submit} className="space-y-3 p-4 bg-surface-secondary rounded-xl border border-border-default">
      <p className="text-sm font-medium text-foreground">
        Assign stock to{' '}
        <span className="font-mono text-secondary-500 dark:text-secondary-400">{location.display_code}</span>
      </p>
      {err && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {err}
        </div>
      )}
      <div>
        <label className={labelCls}>Product / SKU</label>
        <AdminTypeahead
          type="label_products"
          value={query}
          onChange={v => { setQuery(v); if (!v) setSelected(null) }}
          onSelect={handleSelect}
          placeholder="Search product or SKU…"
        />
      </div>

      {selected && (
        <div className="rounded-lg border border-border-default bg-surface p-3 space-y-2">
          {loadingAvail ? (
            <p className="text-xs text-foreground-muted">Loading inventory…</p>
          ) : unallocatedBase !== null ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground-muted">Total inventory</span>
                <span className="font-medium text-foreground">{inventoryDisplay} {unitLabel}</span>
              </div>
              <div className="relative h-2 rounded-full bg-surface-secondary overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-secondary-400 dark:bg-secondary-500 transition-all"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground-muted">
                  On shelves: <span className="font-medium text-foreground">{allocatedDisplay} {unitLabel}</span>
                </span>
                {unallocatedBase > 0 ? (
                  <span className="text-green-600 dark:text-green-400 font-medium">{unallocatedDisplay} available</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">All allocated</span>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {selected && (
        <div>
          <label className={labelCls}>Quantity to assign ({unitLabel})</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className={inputCls}
              min={selected.unitStep}
              step={selected.unitStep}
              max={maxQtyInSellUnits}
              disabled={loadingAvail || unallocatedBase === 0}
            />
            {unallocatedBase !== null && unallocatedBase > 0 && (
              <button
                type="button"
                onClick={() => setQty(String(unallocatedDisplay))}
                className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors whitespace-nowrap"
              >
                All ({unallocatedDisplay})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || !selected || loadingAvail || unallocatedBase === 0} className={btnPrimary}>
          {saving ? 'Saving…' : 'Assign'}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  )
}
