'use client'

import { useState } from 'react'
import Link from 'next/link'
import ImageUpload from './ImageUpload'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface Brand {
  id: string
  name: string
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

  // Organize categories by parent
  const mainCategories = categories.filter(c => !c.parent_category_id)
  const getSubcategories = (parentId: string) => categories.filter(c => c.parent_category_id === parentId)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)

      // Add new image files to formData
      imageFiles.forEach((file, index) => {
        formData.append(`image_${index}`, file)
      })
      formData.append('image_count', imageFiles.length.toString())

      // Add existing images to keep as JSON
      formData.append('existing_images_to_keep', JSON.stringify(existingImagesToKeep))

      await action(formData)
    } catch (err) {
      setError('Failed to save product. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Product Name */}
          <div className="md:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Product Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={product?.name}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product name"
            />
          </div>

          {/* SKU */}
          <div>
            <label htmlFor="sku" className="block text-sm font-medium text-gray-700 mb-2">
              SKU *
            </label>
            <input
              type="text"
              id="sku"
              name="sku"
              required
              defaultValue={product?.sku}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., BOLT-M8-100"
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-2">
              Category *
            </label>
            <select
              id="category_id"
              name="category_id"
              required
              defaultValue={product?.category_id}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
            >
              <option value="">Select a category</option>
              {mainCategories.map(cat => (
                <optgroup key={cat.id} label={cat.name}>
                  <option value={cat.id}>{cat.name}</option>
                  {getSubcategories(cat.id).map(sub => (
                    <option key={sub.id} value={sub.id}>
                      &nbsp;&nbsp;{sub.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Brand */}
          <div>
            <label htmlFor="brand_id" className="block text-sm font-medium text-gray-700 mb-2">
              Brand
            </label>
            <select
              id="brand_id"
              name="brand_id"
              defaultValue={product?.brand_id || ''}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
            >
              <option value="">No Brand</option>
              {brands.map(brand => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          {/* Base Price */}
          <div>
            <label htmlFor="base_price" className="block text-sm font-medium text-gray-700 mb-2">
              Base Price (Rs.) *
            </label>
            <input
              type="number"
              id="base_price"
              name="base_price"
              required
              step="0.01"
              min="0"
              defaultValue={product?.base_price}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0.00"
            />
          </div>

          {/* Sale Price */}
          <div>
            <label htmlFor="sale_price" className="block text-sm font-medium text-gray-700 mb-2">
              Sale Price (Rs.)
            </label>
            <input
              type="number"
              id="sale_price"
              name="sale_price"
              step="0.01"
              min="0"
              defaultValue={product?.sale_price}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0.00 (Optional)"
            />
          </div>

          {/* Wholesale Price */}
          <div>
            <label htmlFor="wholesale_price" className="block text-sm font-medium text-gray-700 mb-2">
              Wholesale Price (Rs.)
            </label>
            <input
              type="number"
              id="wholesale_price"
              name="wholesale_price"
              step="0.01"
              min="0"
              defaultValue={product?.wholesale_price}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0.00 (Optional)"
            />
          </div>

          {/* Stock Quantity */}
          <div>
            <label htmlFor="stock_quantity" className="block text-sm font-medium text-gray-700 mb-2">
              Stock Quantity *
            </label>
            <input
              type="number"
              id="stock_quantity"
              name="stock_quantity"
              required
              min="0"
              defaultValue={product?.stock_quantity || 0}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0"
            />
          </div>

          {/* Low Stock Threshold */}
          <div>
            <label htmlFor="low_stock_threshold" className="block text-sm font-medium text-gray-700 mb-2">
              Low Stock Threshold *
            </label>
            <input
              type="number"
              id="low_stock_threshold"
              name="low_stock_threshold"
              required
              min="0"
              defaultValue={product?.low_stock_threshold || 10}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="10"
            />
          </div>

          {/* Weight */}
          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-2">
              Weight (kg)
            </label>
            <input
              type="number"
              id="weight"
              name="weight"
              step="0.01"
              min="0"
              defaultValue={product?.weight}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0.00"
            />
          </div>

          {/* Dimensions */}
          <div>
            <label htmlFor="dimensions" className="block text-sm font-medium text-gray-700 mb-2">
              Dimensions (L x W x H cm)
            </label>
            <input
              type="text"
              id="dimensions"
              name="dimensions"
              defaultValue={product?.dimensions}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 10 x 5 x 2"
            />
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={product?.description}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
          <div className="md:col-span-2 flex gap-6">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                value="true"
                defaultChecked={product?.is_active ?? true}
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
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
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-gray-300 rounded"
              />
              <label htmlFor="is_featured" className="ml-2 block text-sm text-gray-900">
                Featured Product
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Form Actions */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-4">
        <Link
          href="/admin/products"
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
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
