'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import AdminSelect from '@/components/admin/AdminSelect'
import {
  ALL_DIMENSIONS,
  Dimension,
  DIMENSION_LABEL,
  UNITS,
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
  price_override: number | string | null
  display_label: string | null
  notes: string | null
}

interface Props {
  productId: string
  variantId?: string | null
}

const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 w-full h-[34px]"
const lockedCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface-secondary text-foreground-muted text-sm w-full h-[34px] cursor-not-allowed select-none"

export default function UnitsManager({ productId, variantId }: Props) {
  const { showToast } = useToast()
  const [unit, setUnit] = useState<ProductUnit | null>(null)
  const [inherited, setInherited] = useState(false)
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

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(baseUrl, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const units: ProductUnit[] = data.units || []
        setUnit(units[0] ?? null)
        setInherited(data.inherited ?? false)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productId, variantId])

  function openEdit(u?: ProductUnit) {
    if (u) {
      setDraftUnit(u.unit)
      setDraftDimension(u.dimension)
      setDraftLabel(u.display_label || '')
      setDraftFactor(String(parseFloat(String(u.factor)) || ''))
    } else {
      setDraftUnit('')
      setDraftDimension('count')
      setDraftLabel('')
      setDraftFactor('')
    }
    setEditing(true)
  }

  // When unit selection changes, auto-fill factor for predefined units
  function handleUnitChange(v: string) {
    if (v === '__custom') {
      setDraftUnit('')
      setDraftFactor('')
      return
    }
    setDraftUnit(v)
    const def = (UNITS[draftDimension] || []).find(u => u.key === v)
    if (def?.multiplier != null) {
      setDraftFactor(String(def.multiplier))
    } else {
      setDraftFactor('')
    }
  }

  // When dimension changes, reset unit + factor
  function handleDimensionChange(v: string) {
    setDraftDimension(v as Dimension)
    setDraftUnit('')
    setDraftFactor('')
  }

  async function handleSave() {
    const key = draftUnit.trim()
    if (!key) { showToast('Unit name is required', 'error'); return }

    const factorNum = parseFloat(draftFactor)
    if (!Number.isFinite(factorNum) || factorNum <= 0) {
      showToast('Enter a valid factor (e.g. 12 for dozen)', 'error')
      return
    }

    setSaving(true)
    try {
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
            is_base: true,
            is_sell_default: false,
            is_purchase_default: false,
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
  const isCustomName = draftUnit !== '' && !dimUnits.some(u => u.key === draftUnit)

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
          <div className="flex items-center justify-between bg-surface-elevated border border-border-default rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-foreground">{unit.unit}</span>
              <span className="text-[11px] text-foreground-muted capitalize">{unit.dimension}</span>
              {Number(unit.factor) !== 1 && (
                <span className="text-[11px] text-foreground-muted">× {Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</span>
              )}
              {unit.display_label && (
                <span className="text-[11px] text-foreground-muted">· {unit.display_label}</span>
              )}
              <span className="text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">BASE</span>
            </div>
            <button
              type="button"
              onClick={() => openEdit(inherited ? undefined : unit)}
              className="text-xs text-accent-600 hover:underline"
            >
              {inherited ? 'Override' : 'Edit'}
            </button>
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Dimension</label>
              <AdminSelect
                value={draftDimension}
                onChange={handleDimensionChange}
                options={ALL_DIMENSIONS.map(d => ({ value: d, label: DIMENSION_LABEL[d] }))}
                sm
              />
            </div>

            <div>
              <label className="block text-[10px] text-foreground-muted mb-0.5">Unit name *</label>
              {dimUnits.length > 0 ? (
                <>
                  <AdminSelect
                    value={isCustomName ? '__custom' : draftUnit}
                    onChange={handleUnitChange}
                    placeholder="— pick —"
                    options={[
                      ...dimUnits.map(u => ({ value: u.key, label: u.multiplier != null ? `${u.label} — ${u.multiplier}` : u.label })),
                      { value: '__custom', label: 'Custom…' },
                    ]}
                    sm
                  />
                  {isCustomName && (
                    <input
                      value={draftUnit}
                      onChange={e => setDraftUnit(e.target.value)}
                      className={`${inputCls} mt-1`}
                      placeholder="custom unit name"
                      autoFocus
                    />
                  )}
                </>
              ) : (
                <input
                  value={draftUnit}
                  onChange={e => setDraftUnit(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. roll, bundle"
                />
              )}
            </div>

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
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={draftFactor}
                  onChange={e => setDraftFactor(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 12"
                />
              )}
            </div>

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
