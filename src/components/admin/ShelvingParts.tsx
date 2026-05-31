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
  const [editing, setEditing] = useState(false)
  const [newQty, setNewQty] = useState(String(row.quantity))
  const [moving, setMoving] = useState(false)
  const [destId, setDestId] = useState('')
  const [moveQty, setMoveQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function saveQty() {
    const diff = parseInt(newQty) - row.quantity
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
    const qty = parseInt(moveQty)
    if (!qty || qty <= 0) { setErr('Enter valid quantity'); return }
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
                className="w-16 px-2 py-1 rounded-lg border border-border-default bg-surface text-foreground text-sm text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent"
              />
              <button onClick={saveQty} disabled={saving} aria-label="Save" className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => setEditing(false)} aria-label="Cancel" className="w-7 h-7 flex items-center justify-center rounded-lg border border-border-default hover:bg-surface-secondary text-foreground-secondary transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={() => { setNewQty(String(row.quantity)); setEditing(true) }}
              className="text-sm font-bold tabular-nums text-foreground hover:text-secondary-500 dark:hover:text-secondary-400 transition-colors min-w-[2rem] text-right"
            >
              {row.quantity}
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
          <div className="w-20">
            <label className={labelCls}>Qty</label>
            <input
              type="number"
              value={moveQty}
              onChange={e => setMoveQty(e.target.value)}
              className="w-full px-2 py-2 rounded-lg border border-border-default bg-surface text-foreground text-xs text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors"
              min={1}
              max={row.quantity}
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
  const [selected, setSelected] = useState<{ productId: string; variantId: string | null; subVariantId: string | null; label: string; availableQty: number } | null>(null)
  const [qty, setQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleSelect(item: { id: string; label: string }) {
    const parts = item.id.split('\x1f')
    const rawId = parts[0]
    let productId = '', variantId: string | null = null, subVariantId: string | null = null
    if (rawId.startsWith('product:')) productId = rawId.slice(8)
    else if (rawId.startsWith('variant:')) { variantId = rawId.slice(8); productId = '' }
    else if (rawId.startsWith('subvariant:')) { subVariantId = rawId.slice(11); productId = '' }
    const availableQty = parseInt(parts[11] || '0') || 0
    setSelected({ productId, variantId, subVariantId, label: item.label, availableQty })
    setQuery(item.label)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) { setErr('Select a product first'); return }
    const qtyNum = parseInt(qty)
    if (!qtyNum || qtyNum <= 0) { setErr('Enter valid quantity'); return }
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
          quantity_change: qtyNum,
          reason: 'receive',
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      onSave()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

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
          onChange={setQuery}
          onSelect={handleSelect}
          placeholder="Search product or SKU…"
        />
      </div>
      <div>
        <label className={labelCls}>Quantity</label>
        <div className="flex items-center gap-2">
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} min={1} />
          {selected && selected.availableQty > 0 && (
            <button
              type="button"
              onClick={() => setQty(String(selected.availableQty))}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground-secondary hover:text-foreground transition-colors whitespace-nowrap"
            >
              Use all ({selected.availableQty})
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !selected} className={btnPrimary}>
          {saving ? 'Saving…' : 'Assign'}
        </button>
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  )
}
