'use client'

import { useState } from 'react'
import Link from 'next/link'
import AdminSelect from './AdminSelect'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface CategoryFormProps {
  categories: Category[]
  action: (formData: FormData) => Promise<void>
  category?: any
}

export default function CategoryForm({ categories, action, category }: CategoryFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get only main categories (for parent selection)
  const mainCategories = categories.filter(c => !c.parent_category_id)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)
      await action(formData)
    } catch (err) {
      setError('Failed to save category. Please try again.')
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
          {/* Category Name */}
          <div className="md:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Category Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              defaultValue={category?.name}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter category name"
            />
          </div>

          {/* Parent Category */}
          <AdminSelect
            id="parent_id"
            name="parent_id"
            label="Parent Category"
            defaultValue={category?.parent_category_id || ''}
            hint="Leave empty to create a main category"
            placeholder="None (Main Category)"
            options={[
              { value: '', label: 'None (Main Category)' },
              ...mainCategories.map(cat => ({
                value: cat.id,
                label: cat.name,
              })),
            ]}
          />

          {/* Display Order */}
          <div>
            <label htmlFor="display_order" className="block text-sm font-medium text-foreground-secondary mb-2">
              Display Order *
            </label>
            <input
              type="number"
              id="display_order"
              name="display_order"
              required
              min="0"
              defaultValue={category?.display_order || 0}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Lower numbers appear first
            </p>
          </div>

          {/* SKU Prefix */}
          <div>
            <label htmlFor="sku_prefix" className="block text-sm font-medium text-foreground-secondary mb-2">
              SKU Prefix
            </label>
            <input
              type="text"
              id="sku_prefix"
              name="sku_prefix"
              maxLength={10}
              defaultValue={category?.sku_prefix || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent uppercase"
              placeholder="e.g. BOLT, NUT, WSH"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Used for auto-generating product SKUs (e.g. BOLT-001). If empty, first 3 letters of name are used.
            </p>
          </div>

          {/* Description */}
          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-foreground-secondary mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={category?.description}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter category description"
            />
          </div>

          {/* Active Checkbox */}
          <div className="md:col-span-2">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                value="true"
                defaultChecked={category?.is_active ?? true}
                className="h-4 w-4 text-accent-500 focus:ring-accent-500 border-border-secondary rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-foreground">
                Active
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Form Actions */}
      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex justify-end gap-4">
        <Link
          href="/admin/categories"
          className="px-6 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
        </button>
      </div>
    </form>
  )
}
