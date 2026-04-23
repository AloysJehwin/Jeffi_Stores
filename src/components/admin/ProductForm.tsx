'use client'

import { useState } from 'react'
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
  _isDeleted?: boolean
}

interface ProductFormProps {
  categories: Category[]
  brands: Brand[]
  action: (formData: FormData) => Promise<void>
  product?: any
  productId?: string
}

export default function ProductForm({ categories, brands, action, product, productId }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [existingImagesToKeep, setExistingImagesToKeep] = useState<any[]>([])
  const [tempProductId] = useState<string>(productId || `temp-${Date.now()}`)
  const [hasVariants, setHasVariants] = useState(product?.has_variants ?? false)
  const [variantType, setVariantType] = useState(product?.variant_type ?? '')
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
      }))
    }
    return [
      { variant_name: '', price: '', mrp: '', sale_price: '', wholesale_price: '', stock_quantity: '0', mpn: '', gtin: '' },
      { variant_name: '', price: '', mrp: '', sale_price: '', wholesale_price: '', stock_quantity: '0', mpn: '', gtin: '' },
    ]
  })

  const mainCategories = categories.filter(c => !c.parent_category_id)
  const getSubcategories = (parentId: string) => categories.filter(c => c.parent_category_id === parentId)

  const addVariant = () => {
    setVariants([...variants, { variant_name: '', price: '', mrp: '', sale_price: '', wholesale_price: '', stock_quantity: '0', mpn: '', gtin: '' }])
  }

  const removeVariant = (index: number) => {
    const v = variants[index]
    if (v.id) {
      const updated = [...variants]
      updated[index] = { ...v, _isDeleted: true }
      setVariants(updated)
    } else {
      setVariants(variants.filter((_, i) => i !== index))
    }
  }

  const updateVariant = (index: number, field: keyof VariantRow, value: string) => {
    const updated = [...variants]
    updated[index] = { ...updated[index], [field]: value }
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

      formData.append('existing_images_to_keep', JSON.stringify(existingImagesToKeep))

      formData.set('has_variants', hasVariants ? 'true' : 'false')
      if (hasVariants) {
        formData.set('variant_type', variantType)
        formData.set('variants_json', JSON.stringify(variants))
      }

      await action(formData)
    } catch (err) {
      setError('Failed to save product. Please try again.')
      setIsSubmitting(false)
    }
  }

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

          {/* SKU (read-only if editing) */}
          {product?.sku && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                SKU
              </label>
              <div className="w-full px-4 py-2 border border-border-default rounded-lg bg-surface text-foreground-secondary font-mono text-sm">
                {product.sku}
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

          {/* MPN — hidden when has variants (per-variant instead) */}
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

          {/* GTIN/Barcode — hidden when has variants (per-variant instead) */}
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
              MRP (Rs.)
            </label>
            <input
              type="number"
              id="mrp"
              name="mrp"
              step="0.01"
              min="0"
              defaultValue={product?.mrp}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Maximum Retail Price"
            />
          </div>
          )}

          {/* Selling Price — hidden when has variants */}
          {!hasVariants && (
            <div>
              <label htmlFor="base_price" className="block text-sm font-medium text-foreground-secondary mb-2">
                Selling Price (Rs.) *
              </label>
              <input
                type="number"
                id="base_price"
                name="base_price"
                required={!hasVariants}
                step="0.01"
                min="0"
                defaultValue={product?.base_price}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="Price incl. GST"
              />
              <p className="text-xs text-foreground-muted mt-1">GST-inclusive price the customer pays</p>
            </div>
          )}

          {/* GST Rate */}
          <AdminSelect
            id="gst_percentage"
            name="gst_percentage"
            label="GST Rate *"
            defaultValue={product?.gst_percentage != null ? String(parseFloat(product.gst_percentage)) : '18'}
            options={[
              { value: '0', label: '0% GST' },
              { value: '5', label: '5% GST' },
              { value: '12', label: '12% GST' },
              { value: '18', label: '18% GST' },
              { value: '28', label: '28% GST' },
            ]}
          />

          {/* Sale Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="sale_price" className="block text-sm font-medium text-foreground-secondary mb-2">
              Sale Price (Rs.)
            </label>
            <input
              type="number"
              id="sale_price"
              name="sale_price"
              step="0.01"
              min="0"
              defaultValue={product?.sale_price}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Discounted price (optional)"
            />
          </div>
          )}

          {/* Wholesale Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="wholesale_price" className="block text-sm font-medium text-foreground-secondary mb-2">
              Wholesale Price (Rs.)
            </label>
            <input
              type="number"
              id="wholesale_price"
              name="wholesale_price"
              step="0.01"
              min="0"
              defaultValue={product?.wholesale_price}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Bulk price (optional)"
            />
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

          {/* Weight */}
          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-foreground-secondary mb-2">
              Weight (kg)
            </label>
            <input
              type="number"
              id="weight"
              name="weight"
              step="0.01"
              min="0"
              defaultValue={product?.weight}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0.00"
            />
          </div>

          {/* Dimensions */}
          <div>
            <label htmlFor="dimensions" className="block text-sm font-medium text-foreground-secondary mb-2">
              Dimensions (L x W x H cm)
            </label>
            <input
              type="text"
              id="dimensions"
              name="dimensions"
              defaultValue={product?.dimensions}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 10 x 5 x 2"
            />
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
              onImagesChange={(files, existingToKeep) => {
                setImageFiles(files)
                setExistingImagesToKeep(existingToKeep)
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

              {/* Variant Type */}
              <div className="mb-4">
                <label htmlFor="variant_type_input" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Variant Type *
                </label>
                <input
                  type="text"
                  id="variant_type_input"
                  value={variantType}
                  onChange={(e) => setVariantType(e.target.value)}
                  className="w-full max-w-xs px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="e.g. Length, Size, Weight"
                  required={hasVariants}
                />
                <p className="text-xs text-foreground-muted mt-1">This label is shown to customers (e.g. &quot;Select Length&quot;)</p>
              </div>

              {/* Variant Table */}
              <div className="md:hidden space-y-4">
                {variants.map((variant, index) => {
                  if (variant._isDeleted) return null
                  return (
                    <div key={variant.id || index} className="border border-border-default rounded-lg p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground-muted uppercase">Variant {index + 1}</span>
                        {activeVariants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeVariant(index)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">{variantType || 'Variant'} Name *</label>
                        <input
                          type="text"
                          value={variant.variant_name}
                          onChange={(e) => updateVariant(index, 'variant_name', e.target.value)}
                          className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                          placeholder={`e.g. ${variantType === 'Length' ? '10mm' : variantType === 'Size' ? 'M8' : '...'}`}
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">Selling Price *</label>
                          <input type="number" step="0.01" min="0" value={variant.price} onChange={(e) => updateVariant(index, 'price', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" required />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP</label>
                          <input type="number" step="0.01" min="0" value={variant.mrp} onChange={(e) => updateVariant(index, 'mrp', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">Sale Price</label>
                          <input type="number" step="0.01" min="0" value={variant.sale_price} onChange={(e) => updateVariant(index, 'sale_price', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">Wholesale</label>
                          <input type="number" step="0.01" min="0" value={variant.wholesale_price} onChange={(e) => updateVariant(index, 'wholesale_price', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">Stock *</label>
                          <input type="number" min="0" value={variant.stock_quantity} onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0" required />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                          <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="Part No." />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                        <input type="text" value={variant.gtin} onChange={(e) => updateVariant(index, 'gtin', e.target.value)} className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="Barcode" />
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

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-secondary">
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">{variantType || 'Variant'} Name *</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Selling Price *</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">MRP</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Sale Price</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Wholesale</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">Stock *</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">MPN</th>
                      <th className="text-left py-2 px-2 font-medium text-foreground-secondary">GTIN</th>
                      {product?.sku && <th className="text-left py-2 px-2 font-medium text-foreground-secondary">SKU</th>}
                      <th className="py-2 px-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((variant, index) => {
                      if (variant._isDeleted) return null
                      return (
                        <tr key={variant.id || index} className="border-b border-border-default">
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={variant.variant_name}
                              onChange={(e) => updateVariant(index, 'variant_name', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder={`e.g. ${variantType === 'Length' ? '10mm' : variantType === 'Size' ? 'M8' : variantType === 'Weight' ? '500g' : '...'}`}
                              required
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.price}
                              onChange={(e) => updateVariant(index, 'price', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="0.00"
                              required
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.mrp}
                              onChange={(e) => updateVariant(index, 'mrp', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.sale_price}
                              onChange={(e) => updateVariant(index, 'sale_price', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.wholesale_price}
                              onChange={(e) => updateVariant(index, 'wholesale_price', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="0"
                              value={variant.stock_quantity}
                              onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="0"
                              required
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={variant.mpn}
                              onChange={(e) => updateVariant(index, 'mpn', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="Part No."
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={variant.gtin}
                              onChange={(e) => updateVariant(index, 'gtin', e.target.value)}
                              className="w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                              placeholder="Barcode"
                            />
                          </td>
                          {product?.sku && (
                            <td className="py-2 px-2">
                              <span className="text-xs font-mono text-foreground-muted">
                                {variant.variant_name
                                  ? `${product.sku}-${variant.variant_name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
                                  : '—'
                                }
                              </span>
                            </td>
                          )}
                          <td className="py-2 px-2">
                            {activeVariants.length > 1 && (
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

              <button
                type="button"
                onClick={addVariant}
                className="mt-3 px-4 py-1.5 text-sm font-medium text-accent-600 dark:text-accent-400 border border-accent-300 rounded-lg hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
              >
                + Add Variant
              </button>

              <p className="text-xs text-foreground-muted mt-3">
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
