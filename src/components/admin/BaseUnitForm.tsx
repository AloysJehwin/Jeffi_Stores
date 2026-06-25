import AdminSelect from '@/components/admin/AdminSelect'
import { Dimension, DIMENSION_LABEL, UNITS } from '@/lib/units'

// ── Read-only base unit row ──

export interface BaseUnitRowProps {
  unit: ProductUnit
  basePrice?: number | string | null
  isVariantScope: boolean
  isSubVariantScope: boolean
  inherited: boolean
  saving: boolean
  onEdit: () => void
  onReset: () => void
}

export function BaseUnitRow({ unit, basePrice, isVariantScope, isSubVariantScope, inherited, saving, onEdit, onReset }: BaseUnitRowProps) {
  const siLabel = unit.dimension === 'area' ? 'm²' : unit.dimension === 'volume' ? 'L' : unit.dimension === 'weight' ? 'kg' : 'm'
  return (
    <div className="flex items-center justify-between bg-surface-elevated border border-border-default rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground">{unit.unit}</span>
        <span className="text-border-secondary">|</span>
        <span className="text-[11px] text-foreground-muted">Dimension: <span className="text-foreground">{DIMENSION_LABEL[unit.dimension as Dimension] ?? unit.dimension}</span></span>
        {unit.dimension === 'count' && Number(unit.factor) !== 1 && (
          <><span className="text-border-secondary">·</span><span className="text-[11px] text-foreground-muted">Factor: <span className="text-foreground">{Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} pc</span></span></>
        )}
        {unit.dimension !== 'count' && !unit.conversion_meta?.custom_unit && (
          <><span className="text-border-secondary">·</span><span className="text-[11px] text-foreground-muted">SI factor: <span className="text-foreground">{Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 6 })} {siLabel}</span></span></>
        )}
        {unit.conversion_meta?.custom_unit && (() => {
          const m = unit.conversion_meta
          const dims = m.width && m.height ? `${m.length} × ${m.width} × ${m.height} ${m.dim_unit}` : m.width ? `${m.length} × ${m.width} ${m.dim_unit}` : `${m.length} ${m.dim_unit}`
          return <><span className="text-border-secondary">·</span><span className="text-[11px] text-foreground-muted">Size: <span className="text-foreground">{dims} = {Number(unit.factor).toLocaleString('en-IN', { maximumFractionDigits: 4 })} {siLabel}</span></span></>
        })()}
        {unit.display_label && <><span className="text-border-secondary">·</span><span className="text-[11px] text-foreground-muted">Label: <span className="text-foreground">{unit.display_label}</span></span></>}
        <span className="text-[10px] font-bold text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full ml-1">BASE</span>
        {basePrice != null && basePrice !== '' && !isNaN(Number(basePrice)) && Number(basePrice) > 0 && (
          <><span className="text-border-secondary">·</span>
          <span className="text-[11px] text-foreground-muted" title={isVariantScope ? 'Variant selling price (incl. GST) per BASE unit' : 'Product selling price (incl. GST) per BASE unit'}>
            Price (incl. GST): <span className="text-foreground font-medium">₹{Number(basePrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {unit.unit}</span>
          </span></>
        )}
      </div>
      <div className="flex items-center gap-2">
        {(isVariantScope || isSubVariantScope) && !inherited && (
          <button type="button" onClick={onReset} disabled={saving} className="text-xs text-foreground-muted hover:text-red-500 border border-border-secondary rounded px-2 py-1 disabled:opacity-50">
            {isSubVariantScope ? 'Reset to variant default' : 'Reset to product default'}
          </button>
        )}
        <button type="button" onClick={onEdit} className="text-xs text-accent-600 hover:underline">
          {inherited ? 'Override' : 'Edit'}
        </button>
      </div>
    </div>
  )
}

export interface ProductUnit {
  id: string
  product_id: string
  variant_id: string | null
  unit: string
  factor: number | string
  dimension: Dimension
  conversion_meta: any | null
  is_base: boolean
  display_label: string | null
  notes: string | null
  min_qty: number | null
  max_qty: number | null
  qty_step: number | null
}

const DIMENSIONS: Dimension[] = ['count', 'length', 'area', 'volume', 'weight']

export interface BaseUnitFormProps {
  draftUnit: string; setDraftUnit: (v: string) => void
  draftDimension: Dimension
  draftLabel: string; setDraftLabel: (v: string) => void
  draftFactor: string; setDraftFactor: (v: string) => void
  draftMinQty: string; setDraftMinQty: (v: string) => void
  draftMaxQty: string; setDraftMaxQty: (v: string) => void
  draftQtyStep: string; setDraftQtyStep: (v: string) => void
  isCustomUnit: boolean
  customDimUnit: string; setCustomDimUnit: (v: string) => void
  customLength: string; setCustomLength: (v: string) => void
  customWidth: string; setCustomWidth: (v: string) => void
  customHeight: string; setCustomHeight: (v: string) => void
  dimUnits: any[]; isPredefined: boolean; showFactor: boolean
  customMeasureUnits: any[]
  customPreview: { factor: number; meta: object } | null
  customPreviewLabel: string
  baseUnit: ProductUnit | null; inherited: boolean
  handleDimensionChange: (v: string) => void
  handleUnitChange: (v: string) => void
  saving: boolean
  onSave: () => void
  onCancel: () => void
  inputCls: string; lockedCls: string
}

export default function BaseUnitForm({
  draftUnit, setDraftUnit, draftDimension, draftLabel, setDraftLabel,
  draftFactor, setDraftFactor, draftMinQty, setDraftMinQty, draftMaxQty, setDraftMaxQty,
  draftQtyStep, setDraftQtyStep, isCustomUnit, customDimUnit, setCustomDimUnit,
  customLength, setCustomLength, customWidth, setCustomWidth, customHeight, setCustomHeight,
  dimUnits, isPredefined, showFactor, customMeasureUnits, customPreview, customPreviewLabel,
  baseUnit, inherited, handleDimensionChange, handleUnitChange,
  saving, onSave, onCancel, inputCls, lockedCls,
}: BaseUnitFormProps) {
  return (
    <div className="bg-surface border border-border-default rounded-lg p-3 space-y-3">
      <p className="text-[10px] uppercase tracking-wide text-foreground-muted">
        {baseUnit && !inherited ? 'Edit unit' : 'Set unit'}
      </p>

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
                onClick={() => handleUnitChange('')}
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
          <div className="invisible" aria-hidden />
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
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border-secondary rounded"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
