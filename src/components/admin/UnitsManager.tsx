'use client'

import { useEffect, useMemo, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import {
  ALL_DIMENSIONS,
  Dimension,
  DIMENSION_LABEL,
  UNITS,
  computeAreaFactor,
  computeVolumeFactor,
  sameDimensionFactor,
  getUnitDef,
} from '@/lib/units'

interface ProductUnit {
  id: string
  product_id: string
  variant_id: string
  unit: string
  factor: number | string
  dimension: Dimension
  conversion_meta: any | null
  is_base: boolean
  is_purchase_default: boolean
  is_sell_default: boolean
  price_override: number | string | null
  display_label: string | null
  notes: string | null
}

interface UnitRule {
  id: string
  product_unit_id: string
  rule_type: 'tiered_price' | 'gst_threshold' | 'bonus_qty' | 'bundle_split' | 'physical_variance'
  config: any
  is_active: boolean
  priority: number
}

interface Props {
  productId: string
  variantId: string
  baseUnitName?: string
}

type Mode = 'simple' | 'area' | 'volume' | 'same_dim'

const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-xs focus:ring-1 focus:ring-accent-500 w-full"

export default function UnitsManager({ productId, variantId, baseUnitName }: Props) {
  const { showToast } = useToast()
  const showConfirm = useConfirm()
  const [units, setUnits] = useState<ProductUnit[]>([])
  const [rules, setRules] = useState<UnitRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const baseUrl = `/api/admin/products/${productId}/variants/${variantId}/units`

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(baseUrl, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUnits(data.units || [])
        setRules(data.rules || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productId, variantId])

  const baseUnit = units.find(u => u.is_base)

  // Add-form state
  const [dimension, setDimension] = useState<Dimension>('count')
  const [mode, setMode] = useState<Mode>('simple')
  const [unitKey, setUnitKey] = useState<string>('')
  const [unitLabel, setUnitLabel] = useState<string>('')
  const [factor, setFactor] = useState<string>('')
  const [areaLength, setAreaLength] = useState<string>('')
  const [areaWidth, setAreaWidth] = useState<string>('')
  const [areaDimUnit, setAreaDimUnit] = useState<string>('ft')
  const [volLength, setVolLength] = useState<string>('')
  const [volWidth, setVolWidth] = useState<string>('')
  const [volHeight, setVolHeight] = useState<string>('')
  const [volDimUnit, setVolDimUnit] = useState<string>('cm')
  const [priceOverride, setPriceOverride] = useState<string>('')
  const [isSellDefault, setIsSellDefault] = useState(false)
  const [isPurchaseDefault, setIsPurchaseDefault] = useState(false)

  function resetDraft() {
    setUnitKey('')
    setUnitLabel('')
    setFactor('')
    setAreaLength(''); setAreaWidth('')
    setVolLength(''); setVolWidth(''); setVolHeight('')
    setPriceOverride('')
    setIsSellDefault(false)
    setIsPurchaseDefault(false)
  }

  // Compute the factor from current draft state
  const computedFactor: number | null = useMemo(() => {
    try {
      if (mode === 'simple') {
        const f = parseFloat(factor)
        return Number.isFinite(f) && f > 0 ? f : null
      }
      if (mode === 'area' && baseUnit) {
        const l = parseFloat(areaLength); const w = parseFloat(areaWidth)
        if (!Number.isFinite(l) || !Number.isFinite(w) || l <= 0 || w <= 0) return null
        return computeAreaFactor({ length: l, width: w, dim_unit: areaDimUnit }, baseUnit.unit)
      }
      if (mode === 'volume' && baseUnit) {
        const l = parseFloat(volLength); const w = parseFloat(volWidth); const h = parseFloat(volHeight)
        if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h) || l <= 0 || w <= 0 || h <= 0) return null
        return computeVolumeFactor({ length: l, width: w, height: h, dim_unit: volDimUnit }, baseUnit.unit)
      }
      if (mode === 'same_dim' && baseUnit && unitKey) {
        return sameDimensionFactor(unitKey, baseUnit.unit, dimension)
      }
    } catch { /* user is mid-typing */ }
    return null
  }, [mode, factor, areaLength, areaWidth, areaDimUnit, volLength, volWidth, volHeight, volDimUnit, baseUnit, unitKey, dimension])

  // When dimension changes, reset to a sensible mode
  useEffect(() => {
    if (dimension === 'area') setMode('area')
    else if (dimension === 'volume') setMode('volume')
    else if (dimension === 'count' || dimension === 'custom') { setMode('simple'); setUnitKey('') }
    else setMode('same_dim')
  }, [dimension])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!baseUnit) { showToast('No base unit configured for this variant yet', 'error'); return }
    const finalUnitKey = (mode === 'simple' || mode === 'area' || mode === 'volume') ? unitKey.trim() : unitKey
    if (!finalUnitKey) { showToast('Pick or enter a unit name', 'error'); return }
    const f = computedFactor
    if (f == null || f <= 0) { showToast('Factor must be > 0 — fill the conversion fields', 'error'); return }

    let conversion_meta: any = null
    if (mode === 'area') {
      conversion_meta = { type: 'area', length: parseFloat(areaLength), width: parseFloat(areaWidth), dim_unit: areaDimUnit }
    } else if (mode === 'volume') {
      conversion_meta = { type: 'volume', length: parseFloat(volLength), width: parseFloat(volWidth), height: parseFloat(volHeight), dim_unit: volDimUnit }
    } else if (mode === 'same_dim') {
      conversion_meta = { type: 'same_dim' }
    } else {
      conversion_meta = { type: 'simple' }
    }

    setSaving(true)
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: finalUnitKey,
          factor: f,
          dimension,
          conversion_meta,
          display_label: unitLabel || null,
          price_override: priceOverride ? Number(priceOverride) : null,
          is_sell_default: isSellDefault,
          is_purchase_default: isPurchaseDefault,
        }),
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to add unit', 'error'); return }
      resetDraft()
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function setFlag(unit: ProductUnit, flag: 'is_base' | 'is_sell_default' | 'is_purchase_default') {
    const res = await fetch(`${baseUrl}/${unit.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [flag]: true }),
    })
    if (!res.ok) { const d = await res.json(); showToast(d.error || 'Failed to update', 'error'); return }
    await load()
  }

  async function deleteUnit(u: ProductUnit) {
    if (u.is_base) { showToast('Set another unit as base before deleting this one', 'info'); return }
    const ok = await showConfirm({
      title: 'Delete unit',
      message: `Delete the "${u.unit}" unit and any rules attached to it?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`${baseUrl}/${u.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { const d = await res.json(); showToast((await res.json()).error || 'Failed to delete', 'error'); return }
    await load()
  }

  if (loading) return <div className="text-xs text-foreground-muted py-3">Loading units…</div>

  // Unit name suggestions for the picker
  const dimUnitsForDropdown = UNITS[dimension] || []

  return (
    <div className="border-t border-border-default pt-4 mt-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-secondary">Selling Units</h4>
        <span className="text-[10px] text-foreground-muted">
          Stock + base price live in the BASE unit. Other units convert via factor.
        </span>
      </div>

      {units.length === 0 ? (
        <p className="text-xs text-foreground-muted italic">No units configured.</p>
      ) : (
        <div className="bg-surface-elevated border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-secondary text-[10px] uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">Dim.</th>
                <th className="px-3 py-2 text-right">Factor</th>
                <th className="px-3 py-2 text-left">How it converts</th>
                <th className="px-3 py-2 text-right">Price ovrd.</th>
                <th className="px-3 py-2 text-center">Base</th>
                <th className="px-3 py-2 text-center">Sell def.</th>
                <th className="px-3 py-2 text-center">Buy def.</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {units.map(u => (
                <tr key={u.id} className="hover:bg-surface-secondary/40">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {u.unit}
                    {u.display_label && <p className="text-[10px] text-foreground-muted mt-0.5">{u.display_label}</p>}
                  </td>
                  <td className="px-3 py-2 text-foreground-muted text-[11px] capitalize">{u.dimension}</td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">
                    {Number(u.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-foreground-muted">
                    {describeMeta(u, baseUnit)}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground-secondary">
                    {u.price_override != null ? `₹${Number(u.price_override).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_base
                      ? <span className="text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">BASE</span>
                      : <button type="button" onClick={() => setFlag(u, 'is_base')} className="text-[10px] text-accent-600 hover:underline">make base</button>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_sell_default
                      ? <span className="text-[10px] font-bold text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">DEFAULT</span>
                      : <button type="button" onClick={() => setFlag(u, 'is_sell_default')} className="text-[10px] text-accent-600 hover:underline">set</button>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_purchase_default
                      ? <span className="text-[10px] font-bold text-purple-700 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 px-2 py-0.5 rounded-full">DEFAULT</span>
                      : <button type="button" onClick={() => setFlag(u, 'is_purchase_default')} className="text-[10px] text-accent-600 hover:underline">set</button>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!u.is_base && (
                      <button type="button" onClick={() => deleteUnit(u)} className="text-[10px] text-red-500 hover:text-red-600">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} className="bg-surface border border-border-default rounded-lg p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Add a unit</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Dimension</label>
            <select value={dimension} onChange={e => setDimension(e.target.value as Dimension)} className={inputCls}>
              {ALL_DIMENSIONS.map(d => <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>)}
            </select>
          </div>

          {mode === 'simple' && (
            <>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
                {dimUnitsForDropdown.length > 0 ? (
                  <select value={unitKey} onChange={e => setUnitKey(e.target.value)} className={inputCls}>
                    <option value="">— pick —</option>
                    {dimUnitsForDropdown.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                    <option value="__custom">Custom…</option>
                  </select>
                ) : (
                  <input value={unitKey} onChange={e => setUnitKey(e.target.value)} className={inputCls} placeholder="e.g. bundle" />
                )}
                {unitKey === '__custom' && (
                  <input className={`${inputCls} mt-1`} placeholder="custom name" onChange={e => setUnitKey(e.target.value)} />
                )}
              </div>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">
                  Factor * <span className="text-foreground-muted">(1 {unitKey || dimension} = N {baseUnit?.unit || 'base'})</span>
                </label>
                <input type="number" step="0.0001" min="0.0001" value={factor} onChange={e => setFactor(e.target.value)} className={inputCls} placeholder="100" />
              </div>
            </>
          )}

          {mode === 'same_dim' && (
            <>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">Unit *</label>
                <select value={unitKey} onChange={e => setUnitKey(e.target.value)} className={inputCls}>
                  <option value="">— pick —</option>
                  {dimUnitsForDropdown.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">Factor (auto)</label>
                <input readOnly value={computedFactor != null ? computedFactor.toFixed(6) : ''} className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} placeholder={baseUnit ? `1 ${unitKey || '?'} = ? ${baseUnit.unit}` : ''} />
              </div>
            </>
          )}

          {mode === 'area' && (
            <>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
                <input value={unitKey} onChange={e => setUnitKey(e.target.value)} className={inputCls} placeholder="sheet, panel" />
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-1.5">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Length</label>
                  <input type="number" step="0.01" value={areaLength} onChange={e => setAreaLength(e.target.value)} className={inputCls} placeholder="4" />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Width</label>
                  <input type="number" step="0.01" value={areaWidth} onChange={e => setAreaWidth(e.target.value)} className={inputCls} placeholder="8" />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">In</label>
                  <select value={areaDimUnit} onChange={e => setAreaDimUnit(e.target.value)} className={inputCls}>
                    {UNITS.length.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {mode === 'volume' && (
            <>
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
                <input value={unitKey} onChange={e => setUnitKey(e.target.value)} className={inputCls} placeholder="tin, drum, can" />
              </div>
              <div className="col-span-2 grid grid-cols-4 gap-1.5">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">L</label>
                  <input type="number" step="0.01" value={volLength} onChange={e => setVolLength(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">W</label>
                  <input type="number" step="0.01" value={volWidth} onChange={e => setVolWidth(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">H</label>
                  <input type="number" step="0.01" value={volHeight} onChange={e => setVolHeight(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">In</label>
                  <select value={volDimUnit} onChange={e => setVolDimUnit(e.target.value)} className={inputCls}>
                    {UNITS.length.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        {(mode === 'area' || mode === 'volume' || mode === 'same_dim') && computedFactor != null && (
          <p className="text-[11px] text-foreground-muted">
            → 1 {unitKey || 'unit'} = <span className="font-mono font-semibold text-foreground">{computedFactor.toFixed(4)}</span> {baseUnit?.unit || 'base'}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Label (UI)</label>
            <input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} className={inputCls} placeholder="e.g. Sheet 4'×8'" />
          </div>
          <div>
            <label className="block text-[10px] text-foreground-muted mb-0.5">Price override</label>
            <input type="number" step="0.01" value={priceOverride} onChange={e => setPriceOverride(e.target.value)} className={inputCls} placeholder="optional" />
          </div>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-foreground-secondary">
            <input type="checkbox" checked={isSellDefault} onChange={e => setIsSellDefault(e.target.checked)} />
            Sell default
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-foreground-secondary">
            <input type="checkbox" checked={isPurchaseDefault} onChange={e => setIsPurchaseDefault(e.target.checked)} />
            Purchase default
          </label>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving || computedFactor == null} className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50">
            {saving ? 'Saving…' : '+ Add Unit'}
          </button>
        </div>
      </form>
    </div>
  )
}

function describeMeta(u: ProductUnit, baseUnit?: ProductUnit): string {
  if (u.is_base) return '— base —'
  const m = u.conversion_meta
  if (!m) return `× ${Number(u.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`
  if (m.type === 'area') return `${m.length} × ${m.width} ${m.dim_unit}`
  if (m.type === 'volume') return `${m.length} × ${m.width} × ${m.height} ${m.dim_unit}`
  if (m.type === 'same_dim') return `1 ${u.unit} = ${Number(u.factor).toFixed(4)} ${baseUnit?.unit || 'base'}`
  return `1 ${u.unit} = ${Number(u.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} ${baseUnit?.unit || 'base'}`
}
