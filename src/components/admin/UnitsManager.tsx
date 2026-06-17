'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import UnitRulesPanel, { ProductUnitRule } from '@/components/admin/UnitRulesPanel'
import {
  Dimension,
  DIMENSION_LABEL,
  UNITS,
  computeAreaFactor,
  computeVolumeFactor,
} from '@/lib/units'

interface ProductUnit {
  id: string
  product_id: string
  variant_id: string | null
  unit: string
  factor: number | string
  dimension: Dimension
  conversion_meta: any | null
  is_base: boolean
  is_purchase_default: boolean
  is_sell_default: boolean
  display_label: string | null
  notes: string | null
  min_qty: number | null
  max_qty: number | null
  qty_step: number | null
}

export interface UnitLoadedInfo {
  unitKey: string
  displayLabel: string | null
  dimension: Dimension | null
  inherited: boolean
}

interface Props {
  productId: string
  variantId?: string | null
  /** Variant selling price including GST — shown beside the saved unit row. */
  basePrice?: number | string | null
  onUnitLoaded?: (info: UnitLoadedInfo) => void
}

// Dimensions shown in the picker — no 'custom'
const DIMENSIONS: Dimension[] = ['count', 'length', 'area', 'volume', 'weight']

const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 w-full h-[34px]"
const lockedCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface-secondary text-foreground-muted text-sm w-full h-[34px] cursor-not-allowed select-none"

export default function UnitsManager({ productId, variantId, basePrice, onUnitLoaded }: Props) {
  const { showToast } = useToast()
  const [unit, setUnit] = useState<ProductUnit | null>(null)
  const [inherited, setInherited] = useState(false)
  const [rules, setRules] = useState<ProductUnitRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const baseUrl = variantId
    ? `/api/admin/products/${productId}/variants/${variantId}/units`
    : `/api/admin/products/${productId}/units`
  const isVariantScope = !!variantId

  const [draftUnit, setDraftUnit] = useState('')
  const [draftDimension, setDraftDimension] = useState<Dimension>('count')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftFactor, setDraftFactor] = useState('')
  const [draftMinQty, setDraftMinQty] = useState('1')
  const [draftMaxQty, setDraftMaxQty] = useState('')
  const [draftQtyStep, setDraftQtyStep] = useState('1')

  // custom unit fields (typed dimensions only)
  const [isCustomUnit, setIsCustomUnit] = useState(false)
  const [customDimUnit, setCustomDimUnit] = useState('m')   // the SI unit used for measurement
  const [customLength, setCustomLength] = useState('')
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(baseUrl, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const units: ProductUnit[] = data.units || []
        const first = units[0] ?? null
        const isInherited = data.inherited ?? false
        setUnit(first)
        setInherited(isInherited)
        setRules(data.rules || [])
        onUnitLoaded?.({
          unitKey: first?.unit ?? '',
          displayLabel: first?.display_label ?? null,
          dimension: (first?.dimension as Dimension) ?? null,
          inherited: isInherited,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productId, variantId])

  function resetCustomFields(dimUnit?: string) {
    setIsCustomUnit(false)
    setCustomDimUnit(dimUnit ?? 'm')
    setCustomLength('')
    setCustomWidth('')
    setCustomHeight('')
  }

  function openEdit(u?: ProductUnit) {
    if (u) {
      setDraftDimension(u.dimension)
      setDraftUnit(u.unit)
      setDraftLabel(u.display_label || '')
      setDraftFactor(String(parseFloat(String(u.factor)) || ''))
      setDraftMinQty(u.min_qty != null ? String(u.min_qty) : '1')
      setDraftMaxQty(u.max_qty != null ? String(u.max_qty) : '')
      setDraftQtyStep(u.qty_step != null ? String(u.qty_step) : '1')
      // restore custom unit fields if previously set
      if (u.conversion_meta?.custom_unit) {
        const m = u.conversion_meta
        setIsCustomUnit(true)
        setCustomDimUnit(m.dim_unit || defaultDimUnit(u.dimension))
        setCustomLength(m.length != null ? String(m.length) : '')
        setCustomWidth(m.width != null ? String(m.width) : '')
        setCustomHeight(m.height != null ? String(m.height) : '')
      } else {
        resetCustomFields(defaultDimUnit(u.dimension))
      }
    } else {
      setDraftUnit('')
      setDraftDimension('count')
      setDraftLabel('')
      setDraftFactor('')
      setDraftMinQty('1')
      setDraftMaxQty('')
      setDraftQtyStep('1')
      resetCustomFields()
    }
    setEditing(true)
  }

  function defaultDimUnit(dim: Dimension): string {
    if (dim === 'weight') return 'kg'
    if (dim === 'volume') return 'L'
    return 'm'
  }

  function handleDimensionChange(v: string) {
    const dim = v as Dimension
    setDraftDimension(dim)
    setDraftUnit('')
    setDraftFactor('')
    if (dim === 'count') setDraftQtyStep('1')
    resetCustomFields(defaultDimUnit(dim))
  }

  function handleUnitChange(v: string) {
    if (v === '__custom') {
      setDraftUnit('')
      setIsCustomUnit(true)
      setDraftFactor('')
      return
    }
    setIsCustomUnit(false)
    setCustomLength('')
    setCustomWidth('')
    setCustomHeight('')
    setDraftUnit(v)
    const def = (UNITS[draftDimension] || []).find(u => u.key === v)
    if (def?.multiplier != null) {
      setDraftFactor(String(def.multiplier))
    } else {
      setDraftFactor('')
    }
  }

  // Compute factor + meta for a custom unit in a typed dimension
  function computeCustomFactor(): { factor: number; meta: object } | null {
    try {
      if (draftDimension === 'area') {
        const l = parseFloat(customLength)
        const w = parseFloat(customWidth)
        if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(w) || w <= 0) return null
        const baseUnit = UNITS.area.find(u => u.isSiBase)!
        const factor = computeAreaFactor({ length: l, width: w, dim_unit: customDimUnit }, baseUnit.key)
        return { factor, meta: { custom_unit: true, dim_unit: customDimUnit, length: l, width: w } }
      }
      if (draftDimension === 'volume') {
        const l = parseFloat(customLength)
        const w = parseFloat(customWidth)
        const h = parseFloat(customHeight)
        if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return null
        const baseUnit = UNITS.volume.find(u => u.isSiBase)!
        const factor = computeVolumeFactor({ length: l, width: w, height: h, dim_unit: customDimUnit }, baseUnit.key)
        return { factor, meta: { custom_unit: true, dim_unit: customDimUnit, length: l, width: w, height: h } }
      }
      if (draftDimension === 'length') {
        const val = parseFloat(customLength)
        if (!Number.isFinite(val) || val <= 0) return null
        const srcUnit = UNITS.length.find(u => u.key === customDimUnit)!
        const factor = val * (srcUnit.toSi ?? 1)
        return { factor, meta: { custom_unit: true, dim_unit: customDimUnit, length: val } }
      }
      if (draftDimension === 'weight') {
        const val = parseFloat(customLength)
        if (!Number.isFinite(val) || val <= 0) return null
        const srcUnit = UNITS.weight.find(u => u.key === customDimUnit)!
        const factor = val * (srcUnit.toSi ?? 1)
        return { factor, meta: { custom_unit: true, dim_unit: customDimUnit, length: val } }
      }
    } catch { /* fall through */ }
    return null
  }

  async function handleReset() {
    if (!unit) return
    setSaving(true)
    try {
      const res = await fetch(`${baseUrl}/${unit.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Failed to reset', 'error')
        return
      }
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const key = draftUnit.trim()
    if (!key) { showToast('Unit name is required', 'error'); return }

    let factorNum: number
    let conversionMeta: object | null = null

    if (isCustomUnit && draftDimension !== 'count') {
      const result = computeCustomFactor()
      if (!result) { showToast('Enter valid measurement values', 'error'); return }
      factorNum = result.factor
      conversionMeta = result.meta
    } else if (draftDimension === 'count') {
      factorNum = parseFloat(draftFactor)
      if (!Number.isFinite(factorNum) || factorNum <= 0) {
        showToast('Enter a valid factor (e.g. 12 for dozen)', 'error')
        return
      }
    } else {
      factorNum = 1
    }

    setSaving(true)
    try {
      const minQty = parseFloat(draftMinQty)
      const maxQty = draftMaxQty.trim() ? parseFloat(draftMaxQty) : null
      const qtyStep = draftDimension === 'count' ? 1 : parseFloat(draftQtyStep)
      if (!Number.isFinite(minQty) || minQty <= 0) { showToast('Min qty must be a positive number', 'error'); return }
      if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) { showToast('Max qty must be ≥ min qty', 'error'); return }
      if (!Number.isFinite(qtyStep) || qtyStep <= 0) { showToast('Qty step must be a positive number', 'error'); return }

      if (unit && !inherited) {
        const res = await fetch(`${baseUrl}/${unit.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: key,
            factor: factorNum,
            dimension: draftDimension,
            display_label: draftLabel || null,
            conversion_meta: conversionMeta,
            min_qty: minQty,
            max_qty: maxQty,
            qty_step: qtyStep,
          }),
        })
        const data = await res.json()
        if (!res.ok) { showToast(data.error || 'Failed to update', 'error'); return }
      } else {
        const res = await fetch(baseUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit: key,
            factor: factorNum,
            dimension: draftDimension,
            display_label: draftLabel || null,
            conversion_meta: conversionMeta,
            is_base: true,
            is_sell_default: false,
            is_purchase_default: false,
            min_qty: minQty,
            max_qty: maxQty,
            qty_step: qtyStep,
          }),
        })
        const data = await res.json()
        if (!res.ok) { showToast(data.error || 'Failed to save', 'error'); return }
      }
      setEditing(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-xs text-foreground-muted py-3">Loading…</div>

  const dimUnits = UNITS[draftDimension] || []
  const selectedDef = dimUnits.find(u => u.key === draftUnit)
  const isPredefined = selectedDef?.multiplier != null
  const showFactor = draftDimension === 'count' && !isCustomUnit

  // Length units used for area/length custom inputs; weight units for weight
  const customMeasureUnits =
    draftDimension === 'weight' ? UNITS.weight :
    draftDimension === 'volume' ? UNITS.length :
    UNITS.length  // area, length

  // Live preview for custom unit
  const customPreview = isCustomUnit && draftDimension !== 'count' ? computeCustomFactor() : null
  const customPreviewLabel =
    draftDimension === 'area' ? 'm²' :
    draftDimension === 'volume' ? 'L' :
    draftDimension === 'weight' ? 'kg' : 'm'

  return (
    <div className="border-t border-border-default pt-4 mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-secondary flex items-center gap-2">
          {isVariantScope ? 'Variant Unit' : 'Selling Unit'}
          {isVariantScope && inherited && (
            <span className="text-[10px] font-normal normal-case bg-surface-secondary border border-border-default text-foreground-muted px-2 py-0.5 rounded-full">
              inherited from product
            </span>
          )}
        </h4>
        {!editing && (
          <span className="text-[10px] text-foreground-muted">
            {isVariantScope
              ? inherited ? 'Click Override to set a variant-specific unit.' : 'Variant-specific unit.'
              : 'The unit stock and base price are measured in.'}
          </span>
        )}
      </div>

      {!editing ? (
        unit ? (
          <div className="space-y-2">
          <div className="flex items-center justify-between bg-surface-elevated border border-border-default rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{unit.unit}</span>
              <span className="text-border-secondary">|</span>
              <span className="text-[11px] text-foreground-muted">Dimension: <span className="text-foreground">{DIMENSION_LABEL[unit.dimension as Dimension] ?? unit.dimension}</span></span>
              {unit.dimension === 'count' && Number(unit.factor) !== 1 && (
                <>
                  <span className="text-border-secondary">·</span>
                  <span className="text-[11px] text-foreground-muted">Factor: <span className="text-foreground">{Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} pc</span></span>
                </>
              )}
              {unit.dimension !== 'count' && !unit.conversion_meta?.custom_unit && (() => {
                const siLabel = unit.dimension === 'area' ? 'm²' : unit.dimension === 'volume' ? 'L' : unit.dimension === 'weight' ? 'kg' : 'm'
                const f = Number(unit.factor)
                return (
                  <>
                    <span className="text-border-secondary">·</span>
                    <span className="text-[11px] text-foreground-muted">SI factor: <span className="text-foreground">{f.toLocaleString('en-IN', { maximumFractionDigits: 6 })} {siLabel}</span></span>
                  </>
                )
              })()}
              {unit.conversion_meta?.custom_unit && (() => {
                const m = unit.conversion_meta
                const siLabel = unit.dimension === 'area' ? 'm²' : unit.dimension === 'volume' ? 'L' : unit.dimension === 'weight' ? 'kg' : 'm'
                let dims = ''
                if (m.width && m.height) dims = `${m.length} × ${m.width} × ${m.height} ${m.dim_unit}`
                else if (m.width) dims = `${m.length} × ${m.width} ${m.dim_unit}`
                else dims = `${m.length} ${m.dim_unit}`
                return (
                  <>
                    <span className="text-border-secondary">·</span>
                    <span className="text-[11px] text-foreground-muted">Size: <span className="text-foreground">{dims} = {Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} {siLabel}</span></span>
                  </>
                )
              })()}
              {unit.display_label && (
                <>
                  <span className="text-border-secondary">·</span>
                  <span className="text-[11px] text-foreground-muted">Label: <span className="text-foreground">{unit.display_label}</span></span>
                </>
              )}
              <span className="text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full ml-1">BASE</span>
              {basePrice != null && basePrice !== '' && !isNaN(Number(basePrice)) && Number(basePrice) > 0 && (
                <>
                  <span className="text-border-secondary">·</span>
                  <span
                    className="text-[11px] text-foreground-muted"
                    title={isVariantScope ? "Variant selling price (incl. GST) per BASE unit" : "Product selling price (incl. GST) per BASE unit"}
                  >
                    Price (incl. GST):{' '}
                    <span className="text-foreground font-medium">
                      ₹{Number(basePrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {unit.unit}
                    </span>
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isVariantScope && !inherited && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={saving}
                  className="text-xs text-foreground-muted hover:text-red-500 border border-border-secondary rounded px-2 py-1 disabled:opacity-50"
                >
                  Reset to product default
                </button>
              )}
              <button
                type="button"
                onClick={() => openEdit(inherited ? undefined : unit)}
                className="text-xs text-accent-600 hover:underline"
              >
                {inherited ? 'Override' : 'Edit'}
              </button>
            </div>
          </div>
            {!inherited && (
              <UnitRulesPanel
                productId={productId}
                unitId={unit.id}
                unitVariantId={unit.variant_id}
                rules={rules.filter(r => r.product_unit_id === unit.id)}
                unitLabel={unit.unit}
                onChanged={load}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between bg-surface border border-dashed border-border-default rounded-lg px-4 py-3">
            <span className="text-xs text-foreground-muted italic">No unit set</span>
            <button type="button" onClick={() => openEdit()} className="text-xs text-accent-600 hover:underline">
              Set unit
            </button>
          </div>
        )
      ) : (
        <div className="bg-surface border border-border-default rounded-lg p-3 space-y-3">
          <p className="text-[10px] uppercase tracking-wide text-foreground-muted">
            {unit && !inherited ? 'Edit unit' : isVariantScope ? 'Override unit for this variant' : 'Set unit'}
          </p>

          {/* Top row: always 4 cols — Dimension | Unit name | Factor (count) or empty | Label */}
          <div className="grid grid-cols-4 gap-x-2 items-end">
            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Dimension</label>
              <AdminSelect
                value={draftDimension}
                onChange={handleDimensionChange}
                options={DIMENSIONS.map(d => ({ value: d, label: DIMENSION_LABEL[d] }))}
                sm
              />
            </div>

            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
              {isCustomUnit ? (
                <div className="flex gap-1">
                  <input
                    value={draftUnit}
                    onChange={e => setDraftUnit(e.target.value)}
                    className={`${inputCls} flex-1`}
                    placeholder="e.g. roll, pallet"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setIsCustomUnit(false); setDraftUnit('') }}
                    className="px-2 text-[10px] text-foreground-muted hover:text-foreground border border-border-secondary rounded shrink-0"
                    title="Pick from list"
                  >
                    &#x25C4;
                  </button>
                </div>
              ) : (
                <AdminSelect
                  value={draftUnit}
                  onChange={handleUnitChange}
                  placeholder="— pick —"
                  options={[
                    ...dimUnits.map(u => ({ value: u.key, label: u.label })),
                    { value: '__custom', label: 'Custom…' },
                  ]}
                  sm
                />
              )}
            </div>

            {showFactor ? (
              <div>
                <label className="block text-[10px] text-foreground-muted mb-0.5">
                  {isPredefined ? 'Units per pc (locked)' : 'Units per pc *'}
                </label>
                {isPredefined ? (
                  <div className={lockedCls} title="Predefined — value is fixed">
                    <span className="text-foreground font-mono">{draftFactor}</span>
                    <span className="ml-2 text-[10px] text-foreground-muted">(fixed)</span>
                  </div>
                ) : (
                  <input
                    type="number" step="0.0001" min="0.0001"
                    value={draftFactor}
                    onChange={e => setDraftFactor(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 12"
                  />
                )}
              </div>
            ) : (
              <div className="invisible" aria-hidden>{/* spacer */}</div>
            )}

            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Label (UI)</label>
              <input
                value={draftLabel}
                onChange={e => setDraftLabel(e.target.value)}
                className={inputCls}
                placeholder="e.g. Box of 12"
              />
            </div>
          </div>

          {/* Qty constraints row */}
          <div className="grid grid-cols-3 gap-x-2 items-end">
            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Min qty *</label>
              <input
                type="number" step="any" min="0.000001"
                value={draftMinQty}
                onChange={e => setDraftMinQty(e.target.value)}
                className={inputCls}
                placeholder="1"
              />
            </div>
            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Max qty (blank = stock limit)</label>
              <input
                type="number" step="any" min="0.000001"
                value={draftMaxQty}
                onChange={e => setDraftMaxQty(e.target.value)}
                className={inputCls}
                placeholder="e.g. 200"
              />
            </div>
            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">
                {draftDimension === 'count' ? 'Qty step (locked to 1)' : 'Qty step *'}
              </label>
              {draftDimension === 'count' ? (
                <div className={lockedCls}>
                  <span className="text-foreground font-mono">1</span>
                  <span className="ml-2 text-[10px] text-foreground-muted">(fixed)</span>
                </div>
              ) : (
                <input
                  type="number" step="any" min="0.000001"
                  value={draftQtyStep}
                  onChange={e => setDraftQtyStep(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 0.25"
                />
              )}
            </div>
          </div>

          {/* Custom measurement panel — shown below when Custom… picked for typed dimension */}
          {isCustomUnit && draftDimension !== 'count' && (
            <div className="border border-dashed border-border-secondary rounded p-2 space-y-1">
              <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Measurements</p>
              <div className="grid grid-cols-4 gap-2 items-end">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Unit</label>
                  <AdminSelect
                    value={customDimUnit}
                    onChange={v => setCustomDimUnit(v)}
                    options={customMeasureUnits.map(u => ({ value: u.key, label: u.label }))}
                    sm
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">
                    {draftDimension === 'weight' ? 'Weight *' : 'Length *'}
                  </label>
                  <input
                    type="number" step="0.001" min="0.001"
                    value={customLength}
                    onChange={e => setCustomLength(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 3"
                  />
                </div>
                {(draftDimension === 'area' || draftDimension === 'volume') && (
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Width *</label>
                    <input
                      type="number" step="0.001" min="0.001"
                      value={customWidth}
                      onChange={e => setCustomWidth(e.target.value)}
                      className={inputCls}
                      placeholder="e.g. 2"
                    />
                  </div>
                )}
                {draftDimension === 'volume' && (
                  <div>
                    <label className="block text-[10px] text-foreground-muted mb-0.5">Height *</label>
                    <input
                      type="number" step="0.001" min="0.001"
                      value={customHeight}
                      onChange={e => setCustomHeight(e.target.value)}
                      className={inputCls}
                      placeholder="e.g. 1"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {customPreview && (
            <p className="text-[11px] text-accent-600 font-medium">
              1 {draftUnit || 'unit'} = {customPreview.factor.toLocaleString('en-IN', { maximumFractionDigits: 4 })} {customPreviewLabel}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border-secondary rounded"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
