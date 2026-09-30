'use client'

import AdminSelect from './AdminSelect'

export interface SubVariantDraft {
  name: string
  price: string
  mrp: string
  price_ex_gst: string
  mrp_ex_gst: string
  discount_pct: string
  stock: string
  sku: string
  weight_grams: string
  length_cm: string
  breadth_cm: string
  height_cm: string
  package_type: string
}

export interface InheritedShipping {
  weight_grams?: string
  package_type?: string
  length_cm?: string
  breadth_cm?: string
  height_cm?: string
}

export const DIMS_REQUIRED_TYPES = ['drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube']

const STOCK_OPTIONS = [
  { value: 'In Stock', label: 'In Stock' },
  { value: 'Low Stock', label: 'Low Stock' },
  { value: 'Out of Stock', label: 'Out of Stock' },
]

export function emptySubVariantDraft(): SubVariantDraft {
  return {
    name: '',
    price: '',
    mrp: '',
    price_ex_gst: '',
    mrp_ex_gst: '',
    discount_pct: '',
    stock: '',
    sku: '',
    weight_grams: '',
    length_cm: '',
    breadth_cm: '',
    height_cm: '',
    package_type: '',
  }
}

export function autoSubVariantSku(parentSku: string, name: string): string {
  return parentSku ? `${parentSku}-${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}` : ''
}

function exToIncl(exVal: string, rate: number): string {
  if (!exVal) return ''
  const n = parseFloat(exVal)
  if (isNaN(n) || n < 0) return ''
  if (rate <= 0) return exVal
  return (Math.round(n * (1 + rate / 100) * 100) / 100).toFixed(2)
}

interface Props {
  mode: 'add' | 'edit'
  value: SubVariantDraft
  onChange: (next: SubVariantDraft) => void
  onSubmit: () => void
  onCancel?: () => void
  parentSku: string
  discountPct: string
  gstRate: number
  unitKey?: string | null
  packageTypes: { value: string; label: string }[]
  inherited: InheritedShipping
  disabled?: boolean
}

const inputCls =
  'field-normal w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const lockedCls = `${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function SubVariantEditor({
  mode,
  value: d,
  onChange,
  onSubmit,
  onCancel,
  parentSku,
  discountPct,
  gstRate,
  unitKey,
  packageTypes,
  inherited,
  disabled = false,
}: Props) {
  const set = (patch: Partial<SubVariantDraft>) => onChange({ ...d, ...patch })
  const skuIsAuto = !d.sku || d.sku === autoSubVariantSku(parentSku, d.name)
  const effectivePackage = d.package_type || inherited.package_type || 'flat_poly_auto'
  const needsDims = DIMS_REQUIRED_TYPES.includes(effectivePackage)
  const packageLabel = (v: string) => packageTypes.find(p => p.value === v)?.label || v
  const inheritedPackageLabel = inherited.package_type ? packageLabel(inherited.package_type) : ''
  const per = unitKey ? <span className="ml-1 text-[10px] font-normal text-foreground-muted">/ {unitKey}</span> : null
  const dimPlaceholder = (axis: string, inheritedValue?: string) =>
    inheritedValue ? `${axis} (${inheritedValue})` : axis

  function onNameChange(name: string) {
    set({ name, sku: skuIsAuto ? autoSubVariantSku(parentSku, name) : d.sku })
  }

  function onMrpExChange(v: string) {
    const mrpExN = parseFloat(v)
    const disc = parseFloat(discountPct || '0')
    const mrp = v ? exToIncl(v, gstRate) : ''
    if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
      const priceEx = String(Math.round(mrpExN * (1 - disc / 100) * 100) / 100)
      set({ mrp_ex_gst: v, mrp, price_ex_gst: priceEx, price: exToIncl(priceEx, gstRate) })
    } else {
      set({ mrp_ex_gst: v, mrp, price_ex_gst: '', price: '' })
    }
  }

  const canSubmit = !disabled && d.name.trim().length > 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Name *</label>
          <input
            type="text"
            placeholder="e.g. Red"
            value={d.name}
            onChange={e => onNameChange(e.target.value)}
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelCls}>MRP (Ex. GST) *{per}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="From catalog"
            value={d.mrp_ex_gst}
            onChange={e => onMrpExChange(e.target.value)}
            className={inputCls}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelCls}>Discount %</label>
          <input
            type="number"
            readOnly
            value={discountPct || '0'}
            className={lockedCls}
            title="Product-level discount"
          />
        </div>
        <div>
          <label className={labelCls}>MRP (incl. GST){per}</label>
          <input type="number" readOnly value={d.mrp} className={lockedCls} placeholder="Auto-calculated" />
        </div>
        <div>
          <label className={labelCls}>Price (incl. GST){per}</label>
          <input type="number" readOnly value={d.price} className={lockedCls} placeholder="Auto-calculated" />
        </div>
        <div>
          <label className={labelCls}>Price (Ex. GST){per}</label>
          <input type="number" readOnly value={d.price_ex_gst} className={lockedCls} placeholder="Auto-calculated" />
        </div>
        <div>
          <label className={labelCls}>Stock Status</label>
          <AdminSelect
            md
            value={d.stock || 'In Stock'}
            onChange={v => set({ stock: v })}
            options={STOCK_OPTIONS}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelCls}>SKU {skuIsAuto ? '(auto)' : '(manual)'}</label>
          <input
            type="text"
            placeholder="auto"
            value={d.sku}
            onChange={e => set({ sku: e.target.value })}
            className={inputCls}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="border-t border-border-default pt-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
          <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Shipping</p>
          <p className="text-[11px] text-foreground-muted">
            Blank fields use the variant&apos;s or product&apos;s value.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ship Wt. (g)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={d.weight_grams}
              onChange={e => set({ weight_grams: e.target.value })}
              placeholder={inherited.weight_grams ? `Inherit (${inherited.weight_grams} g)` : 'Required'}
              className={inputCls}
              disabled={disabled}
            />
          </div>
          <div>
            <label className={labelCls}>Package Type</label>
            <AdminSelect
              md
              value={d.package_type}
              onChange={v => set({ package_type: v })}
              options={[
                { value: '', label: inheritedPackageLabel ? `Inherit (${inheritedPackageLabel})` : 'Inherit' },
                ...packageTypes,
              ]}
              disabled={disabled}
            />
          </div>
        </div>
        {needsDims && (
          <div className="mt-3">
            <label className={labelCls}>Dimensions (L × B × H cm)</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                value={d.length_cm}
                onChange={e => set({ length_cm: e.target.value })}
                className={inputCls}
                placeholder={dimPlaceholder('L', inherited.length_cm)}
                disabled={disabled}
              />
              <input
                type="number"
                step="0.1"
                min="0"
                value={d.breadth_cm}
                onChange={e => set({ breadth_cm: e.target.value })}
                className={inputCls}
                placeholder={dimPlaceholder('B', inherited.breadth_cm)}
                disabled={disabled}
              />
              <input
                type="number"
                step="0.1"
                min="0"
                value={d.height_cm}
                onChange={e => set({ height_cm: e.target.value })}
                className={inputCls}
                placeholder={dimPlaceholder('H', inherited.height_cm)}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {mode === 'edit' && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-foreground-secondary hover:text-foreground border border-border-default rounded-lg hover:bg-surface transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-accent-500 hover:bg-accent-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {mode === 'add' ? '+ Add Sub-Variant' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
