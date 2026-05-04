'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ImageUpload from './ImageUpload'
import AdminSelect from './AdminSelect'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface Brand {
  id: string
  name: string
}

interface VariantRow {
  id?: string
  variant_name: string
  price: string
  mrp: string
  sale_price: string
  wholesale_price: string
  stock_quantity: string
  mpn: string
  gtin: string
  pricing_type: 'unit' | 'weight' | 'length'
  unit: string
  numeric_value: string
  weight_rate: string
  weight_unit: string
  weight_rate_on: boolean
  length_rate: string
  length_unit: string
  length_rate_on: boolean
  weight_grams: string
  _isDeleted?: boolean
}

interface VariantGroup {
  pricing_type: 'unit' | 'weight' | 'length'
  unit: string
}

interface ProductFormProps {
  categories: Category[]
  brands: Brand[]
  action: (formData: FormData) => Promise<void>
  product?: any
  productId?: string
}

const WEIGHT_UNITS = ['kg', 'g', 'lb', 'oz']
const LENGTH_UNITS = ['m', 'cm', 'mm', 'ft', 'in']
const UNIT_UNITS = ['pcs', 'pair', 'set', 'box', 'pack', 'roll', 'sheet']

const PRICING_TYPE_LABELS: Record<string, string> = {
  unit: 'By Piece / Unit',
  weight: 'By Weight',
  length: 'By Length',
}

function getUnitOptions(pricing_type: string) {
  if (pricing_type === 'weight') return WEIGHT_UNITS
  if (pricing_type === 'length') return LENGTH_UNITS
  return UNIT_UNITS
}

function getPerUnitLabel(unit: string): string {
  const map: Record<string, string> = {
    kg: '/kg', g: '/100g', lb: '/lb', oz: '/oz',
    m: '/m', cm: '/cm', mm: '/mm', ft: '/ft', in: '/in',
  }
  return map[unit] || `/${unit}`
}

function calcPerUnitRate(price: string, numeric_value: string, unit: string): string | null {
  const p = parseFloat(price)
  const n = parseFloat(numeric_value)
  if (!p || !n || n === 0) return null
  let rate = p / n
  if (unit === 'g') rate = (p / n) * 100
  return `₹${rate.toFixed(2)}${getPerUnitLabel(unit)}`
}

function defaultUnit(pricing_type: string): string {
  if (pricing_type === 'weight') return 'kg'
  if (pricing_type === 'length') return 'm'
  return 'pcs'
}

function emptyVariant(pricing_type: 'unit' | 'weight' | 'length', unit: string): VariantRow {
  return {
    variant_name: '', price: '', mrp: '', sale_price: '', wholesale_price: '',
    stock_quantity: '0', mpn: '', gtin: '',
    pricing_type, unit, numeric_value: '',
    weight_rate: '', weight_unit: 'kg', weight_rate_on: false,
    length_rate: '', length_unit: 'm', length_rate_on: false,
    weight_grams: '',
  }
}

function toInclusive(val: string, rate: number, mode: 'inclusive' | 'exclusive'): string {
  const n = parseFloat(val)
  if (!val || isNaN(n)) return val
  if (mode === 'exclusive') return String(Math.round(n * (1 + rate / 100) * 100) / 100)
  return val
}

function inclusivePreview(val: string, rate: number, mode: 'inclusive' | 'exclusive'): string | null {
  if (mode !== 'exclusive') return null
  const n = parseFloat(val)
  if (!val || isNaN(n) || n <= 0) return null
  return `= ₹${(Math.round(n * (1 + rate / 100) * 100) / 100).toFixed(2)} incl. GST`
}

export default function ProductForm({ categories, brands, action, product, productId }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [existingImagesToKeep, setExistingImagesToKeep] = useState<any[]>([])
  const [galleryImageIds, setGalleryImageIds] = useState<{ id: string; isPrimary: boolean }[]>([])
  const [imageOrder, setImageOrder] = useState<string[]>([])
  const [tempProductId] = useState<string>(productId || `temp-${Date.now()}`)
  const [hasVariants, setHasVariants] = useState(product?.has_variants ?? false)
  const [variantType, setVariantType] = useState(product?.variant_type ?? '')
  const [weightRate, setWeightRate] = useState(product?.weight_rate != null ? String(product.weight_rate) : '')
  const [weightUnit, setWeightUnit] = useState(product?.weight_unit || 'kg')
  const [weightEnabled, setWeightEnabled] = useState(product?.weight_rate != null)
  const [lengthRate, setLengthRate] = useState(product?.length_rate != null ? String(product.length_rate) : '')
  const [lengthUnit, setLengthUnit] = useState(product?.length_unit || 'm')
  const [lengthEnabled, setLengthEnabled] = useState(product?.length_rate != null)
  const gstModeKey = `gstMode:${productId || 'new'}`
  const [gstMode, setGstMode] = useState<'inclusive' | 'exclusive'>(() => {
    if (typeof window === 'undefined') return 'inclusive'
    return (localStorage.getItem(gstModeKey) as 'inclusive' | 'exclusive') || 'inclusive'
  })

  function changeGstMode(mode: 'inclusive' | 'exclusive') {
    localStorage.setItem(gstModeKey, mode)
    setGstMode(mode)
  }
  const [gstRate, setGstRate] = useState<number>(product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18)

  const [basePrice, setBasePrice] = useState(product?.base_price != null ? String(product.base_price) : '')
  const [mrp, setMrp] = useState(product?.mrp != null ? String(product.mrp) : '')
  const [salePrice, setSalePrice] = useState(product?.sale_price != null ? String(product.sale_price) : '')
  const [wholesalePrice, setWholesalePrice] = useState(product?.wholesale_price != null ? String(product.wholesale_price) : '')

  const [variants, setVariants] = useState<VariantRow[]>(() => {
    if (product?.product_variants && product.product_variants.length > 0) {
      return product.product_variants.map((v: any) => ({
        id: v.id,
        variant_name: v.variant_name,
        price: v.price != null ? String(v.price) : '',
        mrp: v.mrp != null ? String(v.mrp) : '',
        sale_price: v.sale_price != null ? String(v.sale_price) : '',
        wholesale_price: v.wholesale_price != null ? String(v.wholesale_price) : '',
        stock_quantity: String(v.stock_quantity || 0),
        mpn: v.mpn || '',
        gtin: v.gtin || '',
        pricing_type: v.pricing_type || 'unit',
        unit: v.unit || 'pcs',
        numeric_value: v.numeric_value != null ? String(v.numeric_value) : '',
        weight_rate: v.weight_rate != null ? String(v.weight_rate) : '',
        weight_unit: v.weight_unit || 'kg',
        weight_rate_on: v.weight_rate != null,
        length_rate: v.length_rate != null ? String(v.length_rate) : '',
        length_unit: v.length_unit || 'm',
        length_rate_on: v.length_rate != null,
        weight_grams: v.weight_grams != null ? String(v.weight_grams) : '',
      }))
    }
    return []
  })

  const [groups, setGroups] = useState<VariantGroup[]>(() => {
    const seen = new Set<string>()
    const result: VariantGroup[] = []
    const src = product?.product_variants?.length > 0 ? product.product_variants : []
    for (const v of src) {
      const pt = v.pricing_type || 'unit'
      if (!seen.has(pt)) {
        seen.add(pt)
        result.push({ pricing_type: pt as any, unit: v.unit || defaultUnit(pt) })
      }
    }
    return result
  })

  const mainCategories = categories.filter(c => !c.parent_category_id)
  const getSubcategories = (parentId: string) => categories.filter(c => c.parent_category_id === parentId)

  function addGroup(pricing_type: 'unit' | 'weight' | 'length') {
    if (groups.find(g => g.pricing_type === pricing_type)) return
    const unit = defaultUnit(pricing_type)
    setGroups([...groups, { pricing_type, unit }])
    setVariants([...variants, emptyVariant(pricing_type, unit)])
  }

  function removeGroup(pricing_type: string) {
    setGroups(groups.filter(g => g.pricing_type !== pricing_type))
    setVariants(variants.map(v => {
      if (v.pricing_type !== pricing_type) return v
      return v.id ? { ...v, _isDeleted: true } : null
    }).filter(Boolean) as VariantRow[])
  }

  function updateGroupUnit(pricing_type: string, unit: string) {
    setGroups(groups.map(g => g.pricing_type === pricing_type ? { ...g, unit } : g))
    setVariants(variants.map(v =>
      v.pricing_type === pricing_type && !v._isDeleted ? { ...v, unit, variant_name: buildVariantName(v.numeric_value, unit, pricing_type) } : v
    ))
  }

  function buildVariantName(numeric_value: string, unit: string, pricing_type: string): string {
    if (pricing_type === 'unit') return ''
    if (!numeric_value) return ''
    return `${numeric_value}${unit}`
  }

  function addVariantToGroup(pricing_type: 'unit' | 'weight' | 'length', unit: string) {
    setVariants([...variants, emptyVariant(pricing_type, unit)])
  }

  function removeVariant(index: number) {
    const v = variants[index]
    if (v.id) {
      const updated = [...variants]
      updated[index] = { ...v, _isDeleted: true }
      setVariants(updated)
    } else {
      setVariants(variants.filter((_, i) => i !== index))
    }
  }

  function updateVariant(index: number, field: keyof VariantRow, value: string | boolean) {
    const updated = [...variants]
    const row = { ...updated[index], [field]: value }
    if ((field === 'numeric_value' || field === 'unit') && row.pricing_type !== 'unit') {
      row.variant_name = buildVariantName(
        field === 'numeric_value' ? (value as string) : row.numeric_value,
        field === 'unit' ? (value as string) : row.unit,
        row.pricing_type
      )
    }
    updated[index] = row
    setVariants(updated)
  }

  function toggleVariantRate(index: number, rateType: 'weight' | 'length') {
    const updated = [...variants]
    const row = { ...updated[index] }
    const onField = rateType === 'weight' ? 'weight_rate_on' : 'length_rate_on'
    const rateField = rateType === 'weight' ? 'weight_rate' : 'length_rate'
    const turningOff = row[onField]
    row[onField] = !turningOff
    if (turningOff) row[rateField] = ''
    updated[index] = row
    setVariants(updated)
  }

  const activeVariants = variants.filter(v => !v._isDeleted)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)

      imageFiles.forEach((file, index) => {
        formData.append(`image_${index}`, file)
      })
      formData.append('image_count', imageFiles.length.toString())
      formData.append('gallery_image_ids', JSON.stringify(galleryImageIds))
      formData.append('image_order', JSON.stringify(imageOrder))
      formData.append('existing_images_to_keep', JSON.stringify(existingImagesToKeep))

      formData.set('has_variants', hasVariants ? 'true' : 'false')
      formData.set('weight_rate', weightEnabled ? weightRate : '')
      formData.set('weight_unit', weightEnabled ? weightUnit : '')
      formData.set('length_rate', lengthEnabled ? lengthRate : '')
      formData.set('length_unit', lengthEnabled ? lengthUnit : '')

      if (!hasVariants) {
        formData.set('base_price', toInclusive(basePrice, gstRate, gstMode))
        formData.set('mrp', toInclusive(mrp, gstRate, gstMode))
        formData.set('sale_price', toInclusive(salePrice, gstRate, gstMode))
        formData.set('wholesale_price', toInclusive(wholesalePrice, gstRate, gstMode))
      } else {
        formData.set('mrp', toInclusive(mrp, gstRate, gstMode))
        formData.set('sale_price', toInclusive(salePrice, gstRate, gstMode))
        formData.set('wholesale_price', toInclusive(wholesalePrice, gstRate, gstMode))
      }

      if (hasVariants) {
        formData.set('variant_type', variantType)
        const convertedVariants = variants.map(v => ({
          ...v,
          price: toInclusive(v.price, gstRate, gstMode),
          mrp: toInclusive(v.mrp, gstRate, gstMode),
          sale_price: toInclusive(v.sale_price, gstRate, gstMode),
          wholesale_price: toInclusive(v.wholesale_price, gstRate, gstMode),
          weight_rate: v.weight_rate_on ? toInclusive(v.weight_rate, gstRate, gstMode) : v.weight_rate,
          length_rate: v.length_rate_on ? toInclusive(v.length_rate, gstRate, gstMode) : v.length_rate,
        }))
        formData.set('variants_json', JSON.stringify(convertedVariants))
      }

      await action(formData)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setError('Failed to save product. Please try again.')
      setIsSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'

  return (
    <form onSubmit={handleSubmit} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="p-4 sm:p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Product Name */}
          <div className="md:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Product Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={product?.name}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product name"
            />
          </div>

          {product?.sku && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                SKU
              </label>
              <div className="w-full px-4 py-2 border border-border-default rounded-lg bg-surface text-foreground-secondary font-mono text-sm uppercase">
                {product.sku.toUpperCase()}
              </div>
              <p className="text-xs text-foreground-muted mt-1">Auto-generated, cannot be changed</p>
            </div>
          )}

          {/* HSN/SAC Code */}
          <div>
            <label htmlFor="hsn_code" className="block text-sm font-medium text-foreground-secondary mb-2">
              HSN/SAC Code
            </label>
            <input
              type="text"
              id="hsn_code"
              name="hsn_code"
              defaultValue={product?.hsn_code}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 8531"
            />
            <p className="text-xs text-foreground-muted mt-1">Required for GST invoices</p>
          </div>

          {/* MPN — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="mpn" className="block text-sm font-medium text-foreground-secondary mb-2">
              MPN (Manufacturer Part No.)
            </label>
            <input
              type="text"
              id="mpn"
              name="mpn"
              defaultValue={product?.mpn}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., TVS-M6X30"
            />
            <p className="text-xs text-foreground-muted mt-1">Used in Google Shopping feed</p>
          </div>
          )}

          {/* GTIN/Barcode — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="gtin" className="block text-sm font-medium text-foreground-secondary mb-2">
              GTIN / Barcode
            </label>
            <input
              type="text"
              id="gtin"
              name="gtin"
              defaultValue={product?.gtin}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="EAN/UPC barcode number"
            />
            <p className="text-xs text-foreground-muted mt-1">Used in Google Shopping feed</p>
          </div>
          )}

          {/* Category */}
          <AdminSelect
            id="category_id"
            name="category_id"
            label="Category *"
            required
            defaultValue={product?.category_id}
            placeholder="Select a category"
            options={mainCategories.flatMap(cat => [
              { value: cat.id, label: cat.name, group: cat.name },
              ...getSubcategories(cat.id).map(sub => ({
                value: sub.id,
                label: sub.name,
                group: cat.name,
                indent: true,
              })),
            ])}
          />

          {/* Brand */}
          <AdminSelect
            id="brand_id"
            name="brand_id"
            label="Brand"
            defaultValue={product?.brand_id || ''}
            placeholder="No Brand"
            options={[
              { value: '', label: 'No Brand' },
              ...brands.map(brand => ({
                value: brand.id,
                label: brand.name,
              })),
            ]}
          />

          {/* MRP — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="mrp" className="block text-sm font-medium text-foreground-secondary mb-2">
              MRP (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="mrp"
              name="mrp"
              step="0.01"
              min="0"
              value={mrp}
              onChange={e => setMrp(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Maximum Retail Price"
            />
            {inclusivePreview(mrp, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(mrp, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Selling Price — hidden when has variants */}
          {!hasVariants && (
            <div>
              <label htmlFor="base_price" className="block text-sm font-medium text-foreground-secondary mb-2">
                Selling Price (Rs.) * {gstMode === 'exclusive' ? '(excl. GST)' : '(incl. GST)'}
              </label>
              <input
                type="number"
                id="base_price"
                name="base_price"
                required={!hasVariants}
                step="0.01"
                min="0"
                value={basePrice}
                onChange={e => setBasePrice(e.target.value)}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder={gstMode === 'exclusive' ? 'Price excl. GST' : 'Price incl. GST'}
              />
              {inclusivePreview(basePrice, gstRate, gstMode)
                ? <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(basePrice, gstRate, gstMode)}</p>
                : <p className="text-xs text-foreground-muted mt-1">GST-inclusive price the customer pays</p>
              }
            </div>
          )}

          {/* GST Rate + Entry Mode */}
          <div className="md:col-span-2">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[140px]">
                <AdminSelect
                  id="gst_percentage"
                  name="gst_percentage"
                  label="GST Rate *"
                  value={String(gstRate)}
                  onChange={(v) => setGstRate(parseFloat(v))}
                  options={[
                    { value: '0', label: '0% GST' },
                    { value: '5', label: '5% GST' },
                    { value: '12', label: '12% GST' },
                    { value: '18', label: '18% GST' },
                    { value: '28', label: '28% GST' },
                  ]}
                />
              </div>
              <div className="pb-0.5">
                <p className="text-xs font-medium text-foreground-secondary mb-1.5">Price entry mode</p>
                <div className="flex rounded-lg border border-border-secondary overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => changeGstMode('inclusive')}
                    className={`px-3 py-1.5 transition-colors ${gstMode === 'inclusive' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-elevated'}`}
                  >
                    GST Inclusive
                  </button>
                  <button
                    type="button"
                    onClick={() => changeGstMode('exclusive')}
                    className={`px-3 py-1.5 transition-colors ${gstMode === 'exclusive' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-elevated'}`}
                  >
                    GST Exclusive
                  </button>
                </div>
              </div>
            </div>
            {gstMode === 'exclusive' && gstRate > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                Prices will be converted to inclusive before saving (×{(1 + gstRate / 100).toFixed(2)})
              </p>
            )}
          </div>

          {/* Sale Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="sale_price" className="block text-sm font-medium text-foreground-secondary mb-2">
              Sale Price (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="sale_price"
              name="sale_price"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={e => setSalePrice(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Discounted price (optional)"
            />
            {inclusivePreview(salePrice, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(salePrice, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Wholesale Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="wholesale_price" className="block text-sm font-medium text-foreground-secondary mb-2">
              Wholesale Price (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="wholesale_price"
              name="wholesale_price"
              step="0.01"
              min="0"
              value={wholesalePrice}
              onChange={e => setWholesalePrice(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Bulk price (optional)"
            />
            {inclusivePreview(wholesalePrice, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(wholesalePrice, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Stock & Low Stock — hidden when has variants */}
          {!hasVariants && (
            <>
              <div>
                <label htmlFor="stock_quantity" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Stock Quantity *
                </label>
                <input
                  type="number"
                  id="stock_quantity"
                  name="stock_quantity"
                  required={!hasVariants}
                  min="0"
                  defaultValue={product?.stock_quantity || 0}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="0"
                />
              </div>

              <div>
                <label htmlFor="low_stock_threshold" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Low Stock Threshold *
                </label>
                <input
                  type="number"
                  id="low_stock_threshold"
                  name="low_stock_threshold"
                  required={!hasVariants}
                  min="0"
                  defaultValue={product?.low_stock_threshold || 10}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="10"
                />
              </div>
            </>
          )}

          {/* Custom Quantity Selling — only for non-variant products */}
          {!hasVariants && (
          <div className="md:col-span-2 border border-border-default rounded-lg p-4 bg-surface-secondary">
            <h3 className="text-sm font-semibold text-foreground mb-1">Custom Quantity Selling</h3>
            <p className="text-xs text-foreground-muted mb-4">Enable if customers can buy any amount (e.g. 2.5 kg). Leave blank to disable a mode.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => { setWeightEnabled(!weightEnabled); if (weightEnabled) setWeightRate('') }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${weightEnabled ? 'bg-accent-500' : 'bg-border-secondary'}`}
                    role="switch"
                    aria-checked={weightEnabled}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${weightEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <label className="text-xs font-medium text-foreground-secondary">Rate per {weightUnit} / weight unit (Rs.)</label>
                </div>
                {weightEnabled && (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={weightRate}
                        onChange={e => setWeightRate(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                        placeholder="e.g. 200"
                      />
                      <AdminSelect
                        value={weightUnit}
                        onChange={setWeightUnit}
                        options={['kg', 'g', 'lb', 'oz'].map(u => ({ value: u, label: u }))}
                        className="w-24"
                      />
                    </div>
                    {weightRate && <p className="text-xs text-accent-600 dark:text-accent-400 mt-1">₹{weightRate}/{weightUnit}</p>}
                  </>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => { setLengthEnabled(!lengthEnabled); if (lengthEnabled) setLengthRate('') }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${lengthEnabled ? 'bg-accent-500' : 'bg-border-secondary'}`}
                    role="switch"
                    aria-checked={lengthEnabled}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${lengthEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <label className="text-xs font-medium text-foreground-secondary">Rate per {lengthUnit} / length unit (Rs.)</label>
                </div>
                {lengthEnabled && (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={lengthRate}
                        onChange={e => setLengthRate(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                        placeholder="e.g. 50"
                      />
                      <AdminSelect
                        value={lengthUnit}
                        onChange={setLengthUnit}
                        options={['m', 'cm', 'mm', 'ft', 'in'].map(u => ({ value: u, label: u }))}
                        className="w-24"
                      />
                    </div>
                    {lengthRate && <p className="text-xs text-accent-600 dark:text-accent-400 mt-1">₹{lengthRate}/{lengthUnit}</p>}
                  </>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Shipping Weight */}
          <div>
            <label htmlFor="weight_grams" className="block text-sm font-medium text-foreground-secondary mb-2">
              Shipping Weight (g)
            </label>
            <input
              type="number"
              id="weight_grams"
              name="weight_grams"
              step="1"
              min="0"
              defaultValue={product?.weight_grams ?? ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 500"
            />
          </div>

          {/* Shipping Dimensions */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Shipping Dimensions (cm)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <input
                  type="number"
                  id="length_cm"
                  name="length_cm"
                  step="0.1"
                  min="0"
                  defaultValue={product?.length_cm ?? ''}
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                  placeholder="L"
                />
                <p className="text-xs text-foreground-muted mt-1 text-center">Length</p>
              </div>
              <div>
                <input
                  type="number"
                  id="breadth_cm"
                  name="breadth_cm"
                  step="0.1"
                  min="0"
                  defaultValue={product?.breadth_cm ?? ''}
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                  placeholder="B"
                />
                <p className="text-xs text-foreground-muted mt-1 text-center">Breadth</p>
              </div>
              <div>
                <input
                  type="number"
                  id="height_cm"
                  name="height_cm"
                  step="0.1"
                  min="0"
                  defaultValue={product?.height_cm ?? ''}
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                  placeholder="H"
                />
                <p className="text-xs text-foreground-muted mt-1 text-center">Height</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-foreground-secondary mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={product?.description}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product description"
            />
          </div>

          {/* Image Upload */}
          <div className="md:col-span-2">
            <ImageUpload
              productId={tempProductId}
              maxImages={5}
              existingImages={product?.product_images || []}
              onImagesChange={(files, existingToKeep, galleryImgs, orderedKeys) => {
                setImageFiles(files)
                setExistingImagesToKeep(existingToKeep)
                setGalleryImageIds(galleryImgs)
                setImageOrder(orderedKeys)
              }}
            />
          </div>

          {/* Checkboxes */}
          <div className="md:col-span-2 flex flex-wrap gap-4 sm:gap-6">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                value="true"
                defaultChecked={product?.is_active ?? true}
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-border-secondary rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-foreground">
                Active
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_featured"
                name="is_featured"
                value="true"
                defaultChecked={product?.is_featured ?? false}
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-border-secondary rounded"
              />
              <label htmlFor="is_featured" className="ml-2 block text-sm text-foreground">
                Featured Product
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="has_variants_toggle"
                checked={hasVariants}
                onChange={(e) => setHasVariants(e.target.checked)}
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-border-secondary rounded"
              />
              <label htmlFor="has_variants_toggle" className="ml-2 block text-sm text-foreground">
                This product has variants
              </label>
            </div>
          </div>

          {/* Variant Management Section */}
          {hasVariants && (
            <div className="md:col-span-2 border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/50 dark:bg-blue-900/20">
              <h3 className="text-sm font-semibold text-foreground mb-4">Product Variants</h3>

              {/* Variant Type label */}
              <div className="mb-5">
                <label htmlFor="variant_type_input" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Variant Label *
                </label>
                <input
                  type="text"
                  id="variant_type_input"
                  value={variantType}
                  onChange={(e) => setVariantType(e.target.value)}
                  className="w-full max-w-xs px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="e.g. Size, Pack, Length"
                  required={hasVariants}
                />
                <p className="text-xs text-foreground-muted mt-1">Shown to customers as &quot;Select {variantType || 'Option'}&quot;</p>
              </div>

              {/* Buying Mode Groups */}
              <div className="space-y-6">
                {groups.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border-secondary p-6 text-center">
                    <p className="text-sm text-foreground-muted mb-3">No variants yet.</p>
                    <button
                      type="button"
                      onClick={() => addGroup('unit')}
                      className="px-4 py-2 text-sm font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface-secondary transition-colors"
                    >
                      + Add Variants
                    </button>
                  </div>
                )}
                {groups.map((group) => {
                  const groupVariants = variants.filter(v => v.pricing_type === group.pricing_type && !v._isDeleted)
                  const allGroupVariants = variants.filter(v => v.pricing_type === group.pricing_type)
                  const unitOptions = getUnitOptions(group.pricing_type)
                  const isWeightOrLength = group.pricing_type !== 'unit'

                  return (
                    <div key={group.pricing_type} className="border border-border-default rounded-lg overflow-hidden">
                      {/* Group header */}
                      <div className="flex items-center justify-between px-4 py-3 bg-surface-secondary border-b border-border-default">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {PRICING_TYPE_LABELS[group.pricing_type]}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-foreground-muted">Unit:</span>
                            <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                              <button
                                type="button"
                                onClick={() => {
                                  const idx = unitOptions.indexOf(group.unit)
                                  updateGroupUnit(group.pricing_type, unitOptions[(idx - 1 + unitOptions.length) % unitOptions.length])
                                }}
                                className="px-2 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none"
                              >‹</button>
                              <span className="px-2 py-1.5 text-sm font-medium text-foreground min-w-[2.5rem] text-center border-x border-border-secondary">
                                {group.unit}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const idx = unitOptions.indexOf(group.unit)
                                  updateGroupUnit(group.pricing_type, unitOptions[(idx + 1) % unitOptions.length])
                                }}
                                className="px-2 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none"
                              >›</button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Mobile cards */}
                      <div className="md:hidden p-3 space-y-3">
                        {groupVariants.map((variant) => {
                          const index = variants.indexOf(variant)
                          const perUnit = isWeightOrLength ? calcPerUnitRate(variant.price, variant.numeric_value, group.unit) : null
                          return (
                            <div key={variant.id || index} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground-muted uppercase">
                                  {isWeightOrLength ? `${group.pricing_type === 'weight' ? 'Weight' : 'Length'} Variant` : 'Variant'}
                                </span>
                                {groupVariants.length > 1 && (
                                  <button type="button" onClick={() => removeVariant(index)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                                    Remove
                                  </button>
                                )}
                              </div>

                              {isWeightOrLength ? (
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                                      Value ({group.unit}) *
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      value={variant.numeric_value}
                                      onChange={(e) => updateVariant(index, 'numeric_value', e.target.value)}
                                      className={inputCls}
                                      placeholder="e.g. 500"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-foreground-secondary mb-1">Variant Name</label>
                                    <input
                                      type="text"
                                      value={variant.variant_name}
                                      readOnly
                                      className={`${inputCls} bg-surface-secondary cursor-default`}
                                      placeholder="Auto-filled"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Name *</label>
                                  <input
                                    type="text"
                                    value={variant.variant_name}
                                    onChange={(e) => updateVariant(index, 'variant_name', e.target.value)}
                                    className={inputCls}
                                    placeholder="e.g. Small, M8, Red"
                                    required
                                  />
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Selling Price {gstMode === 'exclusive' ? '(excl. GST) *' : '*'}</label>
                                  <input type="number" step="0.01" min="0" value={variant.price} onChange={(e) => updateVariant(index, 'price', e.target.value)} className={inputCls} placeholder="0.00" required />
                                  {perUnit && <p className="text-xs text-accent-600 dark:text-accent-400 mt-0.5">{perUnit}</p>}
                                  {inclusivePreview(variant.price, gstRate, gstMode) && <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">{inclusivePreview(variant.price, gstRate, gstMode)}</p>}
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP {gstMode === 'exclusive' ? '(excl.)' : ''}</label>
                                  <input type="number" step="0.01" min="0" value={variant.mrp} onChange={(e) => updateVariant(index, 'mrp', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Sale Price</label>
                                  <input type="number" step="0.01" min="0" value={variant.sale_price} onChange={(e) => updateVariant(index, 'sale_price', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Wholesale</label>
                                  <input type="number" step="0.01" min="0" value={variant.wholesale_price} onChange={(e) => updateVariant(index, 'wholesale_price', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Stock *</label>
                                  <input type="number" min="0" value={variant.stock_quantity} onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)} className={inputCls} placeholder="0" required />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                                  <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className={inputCls} placeholder="Part No." />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                                <input type="text" value={variant.gtin} onChange={(e) => updateVariant(index, 'gtin', e.target.value)} className={inputCls} placeholder="Barcode" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">Shipping Weight (g)</label>
                                <input type="number" step="1" min="0" value={variant.weight_grams} onChange={(e) => updateVariant(index, 'weight_grams', e.target.value)} className={inputCls} placeholder="e.g. 500" />
                              </div>
                              <div className="pt-2 border-t border-border-default space-y-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleVariantRate(index, 'weight')}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.weight_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                    role="switch"
                                    aria-checked={variant.weight_rate_on}
                                  >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${variant.weight_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                  <span className="text-xs font-medium text-foreground-secondary">Also sell by weight</span>
                                </div>
                                {variant.weight_rate_on && (
                                  <div className="flex items-center gap-2 pl-11">
                                    <span className="text-xs text-foreground-muted">Rate (Rs.)</span>
                                    <input type="number" step="0.01" min="0" value={variant.weight_rate} onChange={(e) => updateVariant(index, 'weight_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs" placeholder="e.g. 200" required />
                                    <span className="text-xs text-foreground-muted">per</span>
                                    <AdminSelect value={variant.weight_unit} onChange={(val) => updateVariant(index, 'weight_unit', val)} options={['kg','g','lb','oz'].map(u => ({ value: u, label: u }))} className="w-20" compact />
                                    {variant.weight_rate && <span className="text-xs text-accent-600 dark:text-accent-400">₹{variant.weight_rate}/{variant.weight_unit}</span>}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleVariantRate(index, 'length')}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.length_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                    role="switch"
                                    aria-checked={variant.length_rate_on}
                                  >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${variant.length_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                  <span className="text-xs font-medium text-foreground-secondary">Also sell by length</span>
                                </div>
                                {variant.length_rate_on && (
                                  <div className="flex items-center gap-2 pl-11">
                                    <span className="text-xs text-foreground-muted">Rate (Rs.)</span>
                                    <input type="number" step="0.01" min="0" value={variant.length_rate} onChange={(e) => updateVariant(index, 'length_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs" placeholder="e.g. 50" required />
                                    <span className="text-xs text-foreground-muted">per</span>
                                    <AdminSelect value={variant.length_unit} onChange={(val) => updateVariant(index, 'length_unit', val)} options={['m','cm','mm','ft','in'].map(u => ({ value: u, label: u }))} className="w-20" compact />
                                    {variant.length_rate && <span className="text-xs text-accent-600 dark:text-accent-400">₹{variant.length_rate}/{variant.length_unit}</span>}
                                  </div>
                                )}
                              </div>
                              {product?.sku && variant.variant_name && (
                                <div className="text-xs font-mono text-foreground-muted">
                                  SKU: {product.sku}-{variant.variant_name.toUpperCase().replace(/[^A-Z0-9]/g, '')}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border-secondary bg-surface">
                              {isWeightOrLength && <th className="text-left py-2 px-2 font-medium text-foreground-secondary whitespace-nowrap">Value ({group.unit}) *</th>}
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Name *</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary whitespace-nowrap">Selling Price *</th>
                              {isWeightOrLength && <th className="text-left py-2 px-2 font-medium text-foreground-secondary whitespace-nowrap">Per Unit Rate</th>}
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">MRP</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary whitespace-nowrap">Sale Price</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Wholesale</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Stock *</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">MPN</th>
                              <th className="text-left py-2 px-2 font-medium text-foreground-secondary">GTIN</th>
                              {product?.sku && <th className="text-left py-2 px-2 font-medium text-foreground-secondary">SKU</th>}
                              <th className="py-2 px-2 text-left font-medium text-foreground-secondary whitespace-nowrap text-xs">Wt. Rate</th>
                              <th className="py-2 px-2 text-left font-medium text-foreground-secondary whitespace-nowrap text-xs">Len. Rate</th>
                              <th className="py-2 px-2 text-left font-medium text-foreground-secondary whitespace-nowrap text-xs">Ship Wt.(g)</th>
                              <th className="py-2 px-2 w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupVariants.map((variant) => {
                              const index = variants.indexOf(variant)
                              const perUnit = isWeightOrLength ? calcPerUnitRate(variant.price, variant.numeric_value, group.unit) : null
                              return (
                                <tr key={variant.id || index} className="border-b border-border-default">
                                  {isWeightOrLength && (
                                    <td className="py-2 px-2">
                                      <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        value={variant.numeric_value}
                                        onChange={(e) => updateVariant(index, 'numeric_value', e.target.value)}
                                        className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                                        placeholder="e.g. 500"
                                        required
                                      />
                                    </td>
                                  )}
                                  <td className="py-2 px-2">
                                    {isWeightOrLength ? (
                                      <input
                                        type="text"
                                        value={variant.variant_name}
                                        readOnly
                                        className="w-24 px-2 py-1.5 border border-border-default rounded-lg bg-surface-secondary text-foreground-muted text-sm cursor-default"
                                        placeholder="Auto"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={variant.variant_name}
                                        onChange={(e) => updateVariant(index, 'variant_name', e.target.value)}
                                        className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                                        placeholder="e.g. M8, Red"
                                        required
                                      />
                                    )}
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={variant.price}
                                      onChange={(e) => updateVariant(index, 'price', e.target.value)}
                                      className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                                      placeholder="0.00"
                                      required
                                    />
                                  </td>
                                  {isWeightOrLength && (
                                    <td className="py-2 px-2">
                                      <span className="text-xs font-medium text-accent-600 dark:text-accent-400 whitespace-nowrap">
                                        {perUnit || '—'}
                                      </span>
                                    </td>
                                  )}
                                  <td className="py-2 px-2">
                                    <input type="number" step="0.01" min="0" value={variant.mrp} onChange={(e) => updateVariant(index, 'mrp', e.target.value)} className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="number" step="0.01" min="0" value={variant.sale_price} onChange={(e) => updateVariant(index, 'sale_price', e.target.value)} className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="number" step="0.01" min="0" value={variant.wholesale_price} onChange={(e) => updateVariant(index, 'wholesale_price', e.target.value)} className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="number" min="0" value={variant.stock_quantity} onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)} className="w-20 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0" required />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="Part No." />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input type="text" value={variant.gtin} onChange={(e) => updateVariant(index, 'gtin', e.target.value)} className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="Barcode" />
                                  </td>
                                  {product?.sku && (
                                    <td className="py-2 px-2">
                                      <span className="text-xs font-mono text-foreground-muted whitespace-nowrap">
                                        {variant.variant_name
                                          ? `${product.sku}-${variant.variant_name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
                                          : '—'
                                        }
                                      </span>
                                    </td>
                                  )}
                                  <td className="py-2 px-2">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => toggleVariantRate(index, 'weight')}
                                          className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.weight_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                          role="switch"
                                          aria-checked={variant.weight_rate_on}
                                          title="Also sell by weight"
                                        >
                                          <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${variant.weight_rate_on ? 'translate-x-3' : 'translate-x-0'}`} />
                                        </button>
                                        <span className="text-xs text-foreground-muted whitespace-nowrap">Wt.</span>
                                        {variant.weight_rate_on && (
                                          <>
                                            <input type="number" step="0.01" min="0" value={variant.weight_rate} onChange={(e) => updateVariant(index, 'weight_rate', e.target.value)} className="w-16 px-1.5 py-0.5 border border-border-secondary rounded bg-surface text-foreground focus:ring-1 focus:ring-accent-500 text-xs" placeholder="Rate" required />
                                            <div className="flex items-center border border-border-secondary rounded bg-surface overflow-hidden">
                                              <button type="button" onClick={() => { const opts = ['kg','g','lb','oz']; const i = opts.indexOf(variant.weight_unit); updateVariant(index, 'weight_unit', opts[(i - 1 + opts.length) % opts.length]) }} className="px-1 py-0.5 text-foreground-muted hover:text-foreground hover:bg-surface-secondary text-xs leading-none">&lt;</button>
                                              <span className="px-1 text-xs text-foreground font-medium min-w-[20px] text-center">{variant.weight_unit}</span>
                                              <button type="button" onClick={() => { const opts = ['kg','g','lb','oz']; const i = opts.indexOf(variant.weight_unit); updateVariant(index, 'weight_unit', opts[(i + 1) % opts.length]) }} className="px-1 py-0.5 text-foreground-muted hover:text-foreground hover:bg-surface-secondary text-xs leading-none">&gt;</button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2 px-2">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => toggleVariantRate(index, 'length')}
                                          className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.length_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                          role="switch"
                                          aria-checked={variant.length_rate_on}
                                          title="Also sell by length"
                                        >
                                          <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${variant.length_rate_on ? 'translate-x-3' : 'translate-x-0'}`} />
                                        </button>
                                        <span className="text-xs text-foreground-muted whitespace-nowrap">Len.</span>
                                        {variant.length_rate_on && (
                                          <>
                                            <input type="number" step="0.01" min="0" value={variant.length_rate} onChange={(e) => updateVariant(index, 'length_rate', e.target.value)} className="w-16 px-1.5 py-0.5 border border-border-secondary rounded bg-surface text-foreground focus:ring-1 focus:ring-accent-500 text-xs" placeholder="Rate" required />
                                            <div className="flex items-center border border-border-secondary rounded bg-surface overflow-hidden">
                                              <button type="button" onClick={() => { const opts = ['m','cm','mm','ft','in']; const i = opts.indexOf(variant.length_unit); updateVariant(index, 'length_unit', opts[(i - 1 + opts.length) % opts.length]) }} className="px-1 py-0.5 text-foreground-muted hover:text-foreground hover:bg-surface-secondary text-xs leading-none">&lt;</button>
                                              <span className="px-1 text-xs text-foreground font-medium min-w-[20px] text-center">{variant.length_unit}</span>
                                              <button type="button" onClick={() => { const opts = ['m','cm','mm','ft','in']; const i = opts.indexOf(variant.length_unit); updateVariant(index, 'length_unit', opts[(i + 1) % opts.length]) }} className="px-1 py-0.5 text-foreground-muted hover:text-foreground hover:bg-surface-secondary text-xs leading-none">&gt;</button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={variant.weight_grams}
                                      onChange={(e) => updateVariant(index, 'weight_grams', e.target.value)}
                                      className="w-20 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                                      placeholder="g"
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    {(allGroupVariants.filter(v => !v._isDeleted).length > 1) && (
                                      <button
                                        type="button"
                                        onClick={() => removeVariant(index)}
                                        className="text-red-500 hover:text-red-700 p-1"
                                        title="Remove variant"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Add variant to group */}
                      <div className="px-4 py-3 border-t border-border-default bg-surface">
                        <button
                          type="button"
                          onClick={() => addVariantToGroup(group.pricing_type, group.unit)}
                          className="px-3 py-1.5 text-xs font-medium text-accent-600 dark:text-accent-400 border border-accent-300 rounded-lg hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                        >
                          + Add {PRICING_TYPE_LABELS[group.pricing_type]} Variant
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-foreground-muted mt-4">
                Stock is managed per variant. Product-level stock is not used when variants are enabled.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Form Actions */}
      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
        <Link
          href="/admin/products"
          className="px-6 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors text-center"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : product ? 'Update Product' : 'Create Product'}
        </button>
      </div>
    </form>
  )
}
