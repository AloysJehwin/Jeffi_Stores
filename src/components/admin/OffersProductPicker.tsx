'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import AdminSelect, { type SelectOption } from '@/components/admin/AdminSelect'

interface PickedProduct {
  id: string
  name: string
  sku: string | null
}

interface SuggestItem {
  id: string
  label: string
  sublabel?: string
}

export interface AssignOption extends SelectOption {
  name: string
  count: number
}

type BulkKind = 'category' | 'brand'
type BulkAction = 'add' | 'remove'

const FILTER_THRESHOLD = 12

export default function OfferProductPicker({ offerId, canWrite, categoryOptions, brandOptions }: {
  offerId: string
  canWrite: boolean
  categoryOptions: AssignOption[]
  brandOptions: AssignOption[]
}) {
  const { showToast, showConfirm } = useToast()
  const [members, setMembers] = useState<PickedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SuggestItem[]>([])
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState('')
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = loading || saving || bulkBusy

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offerId}/products`, { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setMembers(d.products || [])
    } catch {
      showToast('Could not load offer products', 'error')
    } finally {
      setLoading(false)
    }
  }, [offerId, showToast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const q = query.trim()
    if (debounce.current) clearTimeout(debounce.current)
    if (q.length < 2) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/admin/product-offers/${offerId}/products?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        const d = await res.json().catch(() => ({}))
        setResults(Array.isArray(d.items) ? d.items : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, offerId])

  async function persist(next: PickedProduct[]) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offerId}/products`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productIds: next.map(p => p.id) }),
      })
      if (!res.ok) { showToast('Failed to save products', 'error'); await load() }
    } catch { showToast('Failed to save products', 'error'); await load() } finally { setSaving(false) }
  }

  function add(item: SuggestItem) {
    if (members.some(m => m.id === item.id)) return
    const next = [...members, { id: item.id, name: item.label, sku: item.sublabel ?? null }]
    setMembers(next)
    setQuery('')
    setResults([])
    persist(next)
  }

  function remove(id: string) {
    const next = members.filter(m => m.id !== id)
    setMembers(next)
    persist(next)
  }

  async function runBulk(kind: BulkKind, action: BulkAction, option: AssignOption) {
    if (action === 'remove') {
      const ok = await showConfirm({
        title: 'Remove products?',
        message: `Every product in ${option.name} will be removed from this offer.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        type: 'danger',
      })
      if (!ok) return
    }
    setBulkBusy(true)
    try {
      const res = await fetch(`/api/admin/product-offers/${offerId}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, [kind === 'category' ? 'categoryId' : 'brandId']: option.value }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(d.error || 'Failed to update products', 'error'); return }
      const n: number = d.changed ?? 0
      const noun = `product${n === 1 ? '' : 's'}`
      const message = action === 'add'
        ? (n ? `Added ${n} ${noun} from ${option.name}` : `Everything in ${option.name} is already in this offer`)
        : (n ? `Removed ${n} ${noun} from ${option.name}` : `No products from ${option.name} were in this offer`)
      showToast(message, 'success')
      await load()
    } catch {
      showToast('Failed to update products', 'error')
    } finally {
      setBulkBusy(false)
    }
  }

  const f = filter.trim().toLowerCase()
  const visible = f
    ? members.filter(m => m.name.toLowerCase().includes(f) || (m.sku ?? '').toLowerCase().includes(f))
    : members

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Products in this offer</h2>
        <span className="text-xs text-foreground-muted">
          {loading ? 'Loading…' : `${members.length} assigned`}{saving || bulkBusy ? ' · saving…' : ''}
        </span>
      </div>

      <RequireWrite scope="coupons:write">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground-secondary mb-1.5">Add a single product</p>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search products by name or SKU…"
                disabled={!canWrite || busy}
                className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60"
              />
              {(results.length > 0 || searching) && query.trim().length >= 2 && (
                <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-border-default bg-surface-elevated shadow-lg">
                  {searching && <p className="px-3 py-2 text-xs text-foreground-muted">Searching…</p>}
                  {results.map(item => {
                    const already = members.some(m => m.id === item.id)
                    return (
                      <button key={item.id} type="button" onClick={() => add(item)} disabled={already}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary disabled:opacity-40 flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{item.label}</span>
                          {item.sublabel && <span className="block truncate text-[11px] text-foreground-muted">{item.sublabel}</span>}
                        </span>
                        {already && <span className="text-[10px] text-foreground-muted shrink-0">added</span>}
                      </button>
                    )
                  })}
                  {!searching && results.length === 0 && <p className="px-3 py-2 text-xs text-foreground-muted">No matches</p>}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <BulkAssign
              label="Assign by category"
              placeholder="Choose a category"
              hint="Includes its subcategories. Only active products are added."
              options={categoryOptions}
              disabled={!canWrite || busy}
              onRun={(action, option) => runBulk('category', action, option)}
            />
            <BulkAssign
              label="Assign by brand"
              placeholder="Choose a brand"
              hint="Only active products are added."
              options={brandOptions}
              disabled={!canWrite || busy}
              onRun={(action, option) => runBulk('brand', action, option)}
            />
          </div>
        </div>
      </RequireWrite>

      <div className="space-y-2 border-t border-border-default pt-4">
        {members.length > FILTER_THRESHOLD && (
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={`Filter ${members.length} assigned products…`}
            className="w-full sm:max-w-sm px-3 py-1.5 rounded-lg border border-border-default bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        )}
        <div className="flex flex-wrap gap-2 max-h-[32rem] overflow-y-auto">
          {!loading && members.length === 0 && (
            <p className="text-xs text-foreground-muted">No products assigned yet.</p>
          )}
          {!loading && members.length > 0 && visible.length === 0 && (
            <p className="text-xs text-foreground-muted">No assigned products match &quot;{filter.trim()}&quot;.</p>
          )}
          {visible.map(m => (
            <span key={m.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-surface-secondary border border-border-default text-xs text-foreground">
              <span className="max-w-[16rem] truncate">{m.name}{m.sku ? ` · ${m.sku}` : ''}</span>
              {canWrite && (
                <button type="button" onClick={() => remove(m.id)} title="Remove" disabled={busy}
                  className="w-4 h-4 rounded-full flex items-center justify-center text-foreground-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40">
                  <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" /></svg>
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function BulkAssign({ label, placeholder, hint, options, disabled, onRun }: {
  label: string
  placeholder: string
  hint: string
  options: AssignOption[]
  disabled: boolean
  onRun: (action: BulkAction, option: AssignOption) => void
}) {
  const [value, setValue] = useState('')
  const selected = options.find(o => o.value === value) ?? null
  const inactive = disabled || !selected

  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-3 space-y-2">
      <AdminSelect
        label={label}
        value={value}
        options={options}
        placeholder={options.length ? placeholder : 'Nothing available'}
        disabled={disabled || options.length === 0}
        onChange={setValue}
        sm
      />
      <p className="text-[11px] text-foreground-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={inactive}
          onClick={() => selected && onRun('add', selected)}
          className="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {selected ? `Add ${selected.count} product${selected.count === 1 ? '' : 's'}` : 'Add all'}
        </button>
        <button
          type="button"
          disabled={inactive}
          onClick={() => selected && onRun('remove', selected)}
          className="px-3 py-1.5 rounded-lg border border-border-default text-xs font-medium text-foreground-secondary hover:text-red-600 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Remove from offer
        </button>
      </div>
    </div>
  )
}
