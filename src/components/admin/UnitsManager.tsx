'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import UnitRulesPanel, { ProductUnitRule } from '@/components/admin/UnitRulesPanel'
import BaseUnitForm, { BaseUnitRow } from '@/components/admin/BaseUnitForm'
import { type ProductUnit } from '@/components/admin/BaseUnitForm'
import {
  Dimension,
  UNITS,
  computeAreaFactor,
  computeVolumeFactor,
} from '@/lib/units'

export interface UnitLoadedInfo {
  unitKey: string
  displayLabel: string | null
  dimension: Dimension | null
  inherited: boolean
}

interface Props {
  productId: string
  variantId?: string | null
  subVariantId?: string | null
  basePrice?: number | string | null
  onUnitLoaded?: (info: UnitLoadedInfo) => void
}

const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 w-full h-[34px]"
const lockedCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface-secondary text-foreground-muted text-sm w-full h-[34px] cursor-not-allowed select-none"

type FormMode = 'base' | 'extra' | null

export default function UnitsManager({ productId, variantId, subVariantId, basePrice, onUnitLoaded }: Props) {
  const { showToast } = useToast()
  const [allUnits, setAllUnits] = useState<ProductUnit[]>([])
  const [inherited, setInherited] = useState(false)
  const [rules, setRules] = useState<ProductUnitRule[]>([])
  const [loading, setLoading] = useState(true)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [editingExtraId, setEditingExtraId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const baseUrl = subVariantId
    ? `/api/admin/products/${productId}/variants/${variantId}/sub-variants/${subVariantId}/units`
    : variantId
      ? `/api/admin/products/${productId}/variants/${variantId}/units`
      : `/api/admin/products/${productId}/units`
  const isVariantScope = !!variantId && !subVariantId
  const isSubVariantScope = !!subVariantId

  // Base unit form state
  const [draftUnit, setDraftUnit] = useState('')
  const [draftDimension, setDraftDimension] = useState<Dimension>('count')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftFactor, setDraftFactor] = useState('')
  const [draftMinQty, setDraftMinQty] = useState('1')
  const [draftMaxQty, setDraftMaxQty] = useState('')
  const [draftQtyStep, setDraftQtyStep] = useState('1')
  const [isCustomUnit, setIsCustomUnit] = useState(false)
  const [customDimUnit, setCustomDimUnit] = useState('m')
  const [customLength, setCustomLength] = useState('')
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')

  // Extra count-unit form state
  const [extraUnit, setExtraUnit] = useState('')
  const [extraFactor, setExtraFactor] = useState('')
  const [extraLabel, setExtraLabel] = useState('')
  const [extraMinQty, setExtraMinQty] = useState('1')
  const [extraMaxQty, setExtraMaxQty] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(baseUrl, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const units: ProductUnit[] = data.units || []
        const isInherited = data.inherited ?? false
        setAllUnits(units)
        setInherited(isInherited)
        setRules(data.rules || [])
        const base = units.find(u => u.is_base) ?? units[0] ?? null
        onUnitLoaded?.({
          unitKey: base?.unit ?? '',
          displayLabel: base?.display_label ?? null,
          dimension: (base?.dimension as Dimension) ?? null,
          inherited: isInherited,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productId, variantId, subVariantId])

  function resetCustomFields(dimUnit?: string) {
    setIsCustomUnit(false)
    setCustomDimUnit(dimUnit ?? 'm')
    setCustomLength('')
    setCustomWidth('')
    setCustomHeight('')
  }

  function defaultDimUnit(dim: Dimension): string {
    if (dim === 'weight') return 'kg'
    if (dim === 'volume') return 'L'
    return 'm'
  }

  function openBaseEdit(u?: ProductUnit) {
    if (u) {
      setDraftDimension(u.dimension)
      setDraftUnit(u.unit)
      setDraftLabel(u.display_label || '')
      setDraftFactor(String(parseFloat(String(u.factor)) || ''))
      setDraftMinQty(u.min_qty != null ? String(Number(u.min_qty)) : '1')
      setDraftMaxQty(u.max_qty != null ? String(Number(u.max_qty)) : '')
      setDraftQtyStep(u.qty_step != null ? String(Number(u.qty_step)) : '1')
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
    setFormMode('base')
  }

  function openExtraEdit(u?: ProductUnit) {
    if (u) {
      setExtraUnit(u.unit)
      setExtraFactor(String(parseFloat(String(u.factor)) || ''))
      setExtraLabel(u.display_label || '')
      setExtraMinQty(u.min_qty != null ? String(Number(u.min_qty)) : '1')
      setExtraMaxQty(u.max_qty != null ? String(Number(u.max_qty)) : '')
      setEditingExtraId(u.id)
    } else {
      setExtraUnit('')
      setExtraFactor('')
      setExtraLabel('')
      setExtraMinQty('1')
      setExtraMaxQty('')
      setEditingExtraId(null)
    }
    setFormMode('extra')
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
    if (def?.multiplier != null) setDraftFactor(String(def.multiplier))
    else setDraftFactor('')
  }

  function computeCustomFactor(): { factor: number; meta: object } | null {
    try {
      if (draftDimension === 'area') {
        const l = parseFloat(customLength), w = parseFloat(customWidth)
        if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(w) || w <= 0) return null
        const baseUnit = UNITS.area.find(u => u.isSiBase)!
        return { factor: computeAreaFactor({ length: l, width: w, dim_unit: customDimUnit }, baseUnit.key), meta: { custom_unit: true, dim_unit: customDimUnit, length: l, width: w } }
      }
      if (draftDimension === 'volume') {
        const l = parseFloat(customLength), w = parseFloat(customWidth), h = parseFloat(customHeight)
        if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return null
        const baseUnit = UNITS.volume.find(u => u.isSiBase)!
        return { factor: computeVolumeFactor({ length: l, width: w, height: h, dim_unit: customDimUnit }, baseUnit.key), meta: { custom_unit: true, dim_unit: customDimUnit, length: l, width: w, height: h } }
      }
      if (draftDimension === 'length') {
        const val = parseFloat(customLength)
        if (!Number.isFinite(val) || val <= 0) return null
        const src = UNITS.length.find(u => u.key === customDimUnit)!
        return { factor: val * (src.toSi ?? 1), meta: { custom_unit: true, dim_unit: customDimUnit, length: val } }
      }
      if (draftDimension === 'weight') {
        const val = parseFloat(customLength)
        if (!Number.isFinite(val) || val <= 0) return null
        const src = UNITS.weight.find(u => u.key === customDimUnit)!
        return { factor: val * (src.toSi ?? 1), meta: { custom_unit: true, dim_unit: customDimUnit, length: val } }
      }
    } catch { /* fall through */ }
    return null
  }

  async function handleResetBase() {
    const base = allUnits.find(u => u.is_base) ?? allUnits[0]
    if (!base) return
    setSaving(true)
    try {
      const res = await fetch(`${baseUrl}/${base.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { showToast((await res.json().catch(() => ({}))).error || 'Failed to reset', 'error'); return }
      await load()
    } finally { setSaving(false) }
  }

  async function handleDeleteExtra(u: ProductUnit) {
    setDeletingId(u.id)
    try {
      const res = await fetch(`${baseUrl}/${u.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) { showToast((await res.json().catch(() => ({}))).error || 'Failed to delete', 'error'); return }
      await load()
    } finally { setDeletingId(null) }
  }

  async function handleSaveBase() {
    const key = draftUnit.trim()
    if (!key) { showToast('Unit name is required', 'error'); return }

    const baseUnit = allUnits.find(u => u.is_base) ?? allUnits[0] ?? null

    let factorNum: number
    let conversionMeta: object | null = null

    if (isCustomUnit && draftDimension !== 'count') {
      const result = computeCustomFactor()
      if (!result) { showToast('Enter valid measurement values', 'error'); return }
      factorNum = result.factor; conversionMeta = result.meta
    } else if (draftDimension === 'count') {
      factorNum = parseFloat(draftFactor)
      if (!Number.isFinite(factorNum) || factorNum <= 0) { showToast('Enter a valid factor (e.g. 12 for dozen)', 'error'); return }
    } else {
      factorNum = 1
    }

    const minQty = parseFloat(draftMinQty)
    const maxQty = draftMaxQty.trim() ? parseFloat(draftMaxQty) : null
    const qtyStep = draftDimension === 'count' ? 1 : parseFloat(draftQtyStep)
    if (!Number.isFinite(minQty) || minQty <= 0) { showToast('Min qty must be a positive number', 'error'); return }
    if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) { showToast('Max qty must be ≥ min qty', 'error'); return }
    if (!Number.isFinite(qtyStep) || qtyStep <= 0) { showToast('Qty step must be a positive number', 'error'); return }

    const payload = { unit: key, factor: factorNum, dimension: draftDimension, display_label: draftLabel || null, conversion_meta: conversionMeta, min_qty: minQty, max_qty: maxQty, qty_step: qtyStep }

    setSaving(true)
    try {
      const res = baseUnit && !inherited
        ? await fetch(`${baseUrl}/${baseUnit.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(baseUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, is_base: true }) })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to save', 'error'); return }
      setFormMode(null)
      await load()
    } finally { setSaving(false) }
  }

  async function handleSaveExtra() {
    const key = extraUnit.trim()
    if (!key) { showToast('Unit name is required', 'error'); return }

    const factorNum = parseFloat(extraFactor)
    if (!Number.isFinite(factorNum) || factorNum <= 0) { showToast('Enter a valid pcs count (e.g. 12 for dozen)', 'error'); return }
    const minQty = parseFloat(extraMinQty)
    const maxQty = extraMaxQty.trim() ? parseFloat(extraMaxQty) : null
    if (!Number.isFinite(minQty) || minQty <= 0) { showToast('Min qty must be a positive number', 'error'); return }
    if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) { showToast('Max qty must be ≥ min qty', 'error'); return }

    const payload = { unit: key, factor: factorNum, dimension: 'count', display_label: extraLabel || null, min_qty: minQty, max_qty: maxQty, qty_step: 1 }

    setSaving(true)
    try {
      const res = editingExtraId
        ? await fetch(`${baseUrl}/${editingExtraId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(baseUrl, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, is_base: false }) })
      const data = await res.json()
      if (!res.ok) { showToast(data.error || 'Failed to save', 'error'); return }
      setFormMode(null)
      setEditingExtraId(null)
      await load()
    } finally { setSaving(false) }
  }

  if (loading) return <div className="text-xs text-foreground-muted py-3">Loading…</div>

  const baseUnit = allUnits.find(u => u.is_base) ?? allUnits[0] ?? null
  const extraCountUnits = allUnits.filter(u => !u.is_base && u.dimension === 'count')
  const showExtraSection = !baseUnit || baseUnit.dimension === 'count'

  const dimUnits = UNITS[draftDimension] || []
  const selectedDef = dimUnits.find(u => u.key === draftUnit)
  const isPredefined = selectedDef?.multiplier != null
  const showFactor = draftDimension === 'count' && !isCustomUnit
  const customMeasureUnits = draftDimension === 'weight' ? UNITS.weight : UNITS.length
  const customPreview = isCustomUnit && draftDimension !== 'count' ? computeCustomFactor() : null
  const customPreviewLabel = draftDimension === 'area' ? 'm²' : draftDimension === 'volume' ? 'L' : draftDimension === 'weight' ? 'kg' : 'm'

  return (
    <div className="border-t border-border-default pt-4 mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-secondary flex items-center gap-2">
          {isSubVariantScope ? 'Sub-variant Unit' : isVariantScope ? 'Variant Unit' : 'Selling Unit'}
          {(isVariantScope || isSubVariantScope) && inherited && (
            <span className="text-[10px] font-normal normal-case bg-surface-secondary border border-border-default text-foreground-muted px-2 py-0.5 rounded-full">
              inherited from {isSubVariantScope ? 'variant' : 'product'}
            </span>
          )}
        </h4>
        {formMode === null && (
          <span className="text-[10px] text-foreground-muted">
            {isSubVariantScope
              ? inherited ? 'Click Override to set a sub-variant-specific unit.' : 'Sub-variant-specific unit.'
              : isVariantScope
                ? inherited ? 'Click Override to set a variant-specific unit.' : 'Variant-specific unit.'
                : 'The unit stock and base price are measured in.'}
          </span>
        )}
      </div>

      {/* Base unit */}
      {formMode === 'base' ? (
        <BaseUnitForm
          draftUnit={draftUnit} setDraftUnit={setDraftUnit}
          draftDimension={draftDimension}
          draftLabel={draftLabel} setDraftLabel={setDraftLabel}
          draftFactor={draftFactor} setDraftFactor={setDraftFactor}
          draftMinQty={draftMinQty} setDraftMinQty={setDraftMinQty}
          draftMaxQty={draftMaxQty} setDraftMaxQty={setDraftMaxQty}
          draftQtyStep={draftQtyStep} setDraftQtyStep={setDraftQtyStep}
          isCustomUnit={isCustomUnit}
          customDimUnit={customDimUnit} setCustomDimUnit={setCustomDimUnit}
          customLength={customLength} setCustomLength={setCustomLength}
          customWidth={customWidth} setCustomWidth={setCustomWidth}
          customHeight={customHeight} setCustomHeight={setCustomHeight}
          dimUnits={dimUnits} isPredefined={isPredefined} showFactor={showFactor}
          customMeasureUnits={customMeasureUnits}
          customPreview={customPreview} customPreviewLabel={customPreviewLabel}
          baseUnit={baseUnit} inherited={inherited}
          handleDimensionChange={handleDimensionChange}
          handleUnitChange={handleUnitChange}
          saving={saving}
          onSave={handleSaveBase}
          onCancel={() => setFormMode(null)}
          inputCls={inputCls} lockedCls={lockedCls}
        />
      ) : baseUnit ? (
        <div className="space-y-2">
          <BaseUnitRow
            unit={baseUnit} basePrice={basePrice}
            isVariantScope={isVariantScope} isSubVariantScope={isSubVariantScope}
            inherited={inherited} saving={saving}
            onEdit={() => openBaseEdit(inherited ? undefined : baseUnit)}
            onReset={handleResetBase}
          />
          {!inherited && (
            <UnitRulesPanel
              productId={productId}
              unitId={baseUnit.id}
              unitVariantId={baseUnit.variant_id}
              rules={rules.filter(r => r.product_unit_id === baseUnit.id)}
              unitLabel={baseUnit.unit}
              onChanged={load}
            />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between bg-surface border border-dashed border-border-default rounded-lg px-4 py-3">
          <span className="text-xs text-foreground-muted italic">No unit set</span>
          <button type="button" onClick={() => openBaseEdit()} className="text-xs text-accent-600 hover:underline">Set unit</button>
        </div>
      )}

      {/* Additional count units */}
      {showExtraSection && !inherited && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
              Additional selling units
              <span className="ml-1.5 text-[10px] font-normal normal-case text-foreground-muted/70">(e.g. box=100 pcs, dozen=12 pcs)</span>
            </h5>
            {formMode !== 'extra' && (
              <button type="button" onClick={() => openExtraEdit()} className="text-xs text-accent-600 hover:underline flex items-center gap-1">
                <span className="text-base leading-none">+</span> Add unit
              </button>
            )}
          </div>

          {extraCountUnits.length > 0 && (
            <div className="space-y-1.5">
              {extraCountUnits.map(u => (
                <div key={u.id} className="flex items-center justify-between bg-surface-elevated border border-border-default rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-semibold text-foreground text-sm">{u.unit}</span>
                    <span className="text-border-secondary">·</span>
                    <span className="text-foreground-muted">{Number(u.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} pcs</span>
                    {u.display_label && <><span className="text-border-secondary">·</span><span className="text-foreground-muted">&ldquo;{u.display_label}&rdquo;</span></>}
                    {u.min_qty != null && Number(u.min_qty) !== 1 && <><span className="text-border-secondary">·</span><span className="text-foreground-muted">min {Number(u.min_qty)}</span></>}
                    {u.max_qty != null && <><span className="text-border-secondary">·</span><span className="text-foreground-muted">max {Number(u.max_qty)}</span></>}
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <button type="button" onClick={() => { setFormMode(null); setTimeout(() => openExtraEdit(u), 0) }} className="text-xs text-accent-600 hover:underline">Edit</button>
                    <button type="button" onClick={() => handleDeleteExtra(u)} disabled={deletingId === u.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                      {deletingId === u.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {extraCountUnits.length === 0 && formMode !== 'extra' && (
            <p className="text-[11px] text-foreground-muted italic px-1">
              No additional units. Add a box, carton, dozen, etc. to let admin staff sell in bulk units on invoices/quotations.
            </p>
          )}

          {formMode === 'extra' && (
            <div className="bg-surface border border-border-default rounded-lg p-3 space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-foreground-muted">{editingExtraId ? 'Edit selling unit' : 'Add selling unit'}</p>
              <div className="grid grid-cols-4 gap-x-2 items-end">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
                  <input value={extraUnit} onChange={e => setExtraUnit(e.target.value)} className={inputCls} placeholder="e.g. box, dozen, carton" autoFocus />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Pcs per unit *</label>
                  <input type="number" step="1" min="2" value={extraFactor} onChange={e => setExtraFactor(e.target.value)} className={inputCls} placeholder="e.g. 100" />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Label (UI)</label>
                  <input value={extraLabel} onChange={e => setExtraLabel(e.target.value)} className={inputCls} placeholder="e.g. Box of 100" />
                </div>
                <div className="invisible" aria-hidden />
              </div>
              <div className="grid grid-cols-3 gap-x-2 items-end">
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Min qty *</label>
                  <input type="number" step="1" min="1" value={extraMinQty} onChange={e => setExtraMinQty(e.target.value)} className={inputCls} placeholder="1" />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Max qty (blank = stock limit)</label>
                  <input type="number" step="1" min="1" value={extraMaxQty} onChange={e => setExtraMaxQty(e.target.value)} className={inputCls} placeholder="e.g. 50" />
                </div>
                <div>
                  <label className="block text-[10px] text-foreground-muted mb-0.5">Qty step (locked to 1)</label>
                  <div className={lockedCls}><span className="text-foreground font-mono">1</span><span className="ml-2 text-[10px] text-foreground-muted">(fixed)</span></div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setFormMode(null); setEditingExtraId(null) }} className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border-secondary rounded">Cancel</button>
                <button type="button" onClick={handleSaveExtra} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50">
                  {saving ? 'Saving…' : editingExtraId ? 'Update' : 'Add unit'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
