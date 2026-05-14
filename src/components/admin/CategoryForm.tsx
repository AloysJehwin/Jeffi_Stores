'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import AdminSelect from './AdminSelect'
import * as Icons from 'lucide-react'

const ICON_OPTIONS = [
  'Anchor', 'Anvil', 'Aperture', 'Axe', 'Battery', 'BatteryCharging',
  'Bolt', 'Box', 'Boxes', 'Brush', 'Cable', 'CircuitBoard', 'Cog',
  'Cpu', 'Disc', 'Disc2', 'Drill', 'Filter', 'Flame', 'Flashlight',
  'FlaskConical', 'Forklift', 'Gauge', 'Grip', 'Hammer', 'Hexagon',
  'HardHat', 'Layers', 'Link', 'Link2', 'Magnet', 'Microchip',
  'Nut', 'Package', 'Paintbrush', 'PaintRoller', 'PencilRuler',
  'Pickaxe', 'Pipette', 'Plug', 'PlugZap', 'Ruler', 'Satellite',
  'ScanLine', 'Scissors', 'Settings', 'Shield', 'Shovel', 'Spade',
  'SprayCan', 'TestTube', 'Thermometer', 'ToolCase', 'Toolbox',
  'Truck', 'Warehouse', 'Weight', 'Wind', 'Wrench', 'Zap',
]

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

function IconPreview({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as any)[name] as React.FC<{ className?: string }> | undefined
  if (!Icon) return <Icons.Package className={className} />
  return <Icon className={className} />
}

export default function CategoryForm({ categories, action, category }: CategoryFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIcon, setSelectedIcon] = useState<string>(category?.icon_name || 'Package')
  const [iconSearch, setIconSearch] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  const mainCategories = categories.filter(c => !c.parent_category_id)

  const filteredIcons = useMemo(() =>
    ICON_OPTIONS.filter(n => n.toLowerCase().includes(iconSearch.toLowerCase())),
    [iconSearch]
  )

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const formData = new FormData(e.currentTarget)
      await action(formData)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
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

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Category Icon
              {!category?.icon_name && (
                <span className="ml-2 text-xs text-foreground-muted font-normal">AI will auto-select on save</span>
              )}
            </label>

            <input type="hidden" name="icon_name" value={selectedIcon} />

            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center border-2 border-accent-300 dark:border-accent-700 shrink-0">
                <IconPreview name={selectedIcon} className="w-7 h-7 text-accent-600 dark:text-accent-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{selectedIcon}</p>
                <button
                  type="button"
                  onClick={() => setShowPicker(v => !v)}
                  className="mt-1 text-xs text-accent-500 hover:text-accent-600 underline"
                >
                  {showPicker ? 'Close picker' : 'Change icon'}
                </button>
              </div>
            </div>

            {showPicker && (
              <div className="mt-3 border border-border-secondary rounded-lg bg-surface p-3">
                <input
                  type="text"
                  placeholder="Search icons..."
                  value={iconSearch}
                  onChange={e => setIconSearch(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-border-secondary rounded-md bg-surface-elevated text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent mb-3"
                />
                <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5 max-h-48 overflow-y-auto">
                  {filteredIcons.map(name => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => { setSelectedIcon(name); setShowPicker(false); setIconSearch('') }}
                      className={`p-2 rounded-md flex items-center justify-center transition-colors ${
                        selectedIcon === name
                          ? 'bg-accent-500 text-white'
                          : 'hover:bg-surface-secondary text-foreground-muted hover:text-foreground'
                      }`}
                    >
                      <IconPreview name={name} className="w-5 h-5" />
                    </button>
                  ))}
                  {filteredIcons.length === 0 && (
                    <p className="col-span-12 text-xs text-foreground-muted text-center py-4">No icons match</p>
                  )}
                </div>
              </div>
            )}
          </div>

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
            <p className="text-xs text-foreground-muted mt-1">Lower numbers appear first</p>
          </div>

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

          <div className="md:col-span-2">
            <label htmlFor="google_product_category" className="block text-sm font-medium text-foreground-secondary mb-2">
              Google Product Category
            </label>
            <input
              type="text"
              id="google_product_category"
              name="google_product_category"
              defaultValue={category?.google_product_category || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., Hardware > Fasteners > Bolts"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Google taxonomy path or ID for Merchant Center.{' '}
              <a href="https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt" target="_blank" rel="noopener noreferrer" className="text-accent-500 underline">
                Google Product Taxonomy
              </a>
            </p>
          </div>

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
