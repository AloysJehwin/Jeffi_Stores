import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories } from '@/lib/queries'
import { query } from '@/lib/db'
import CategoryForm from '@/components/admin/CategoryForm'
import { suggestIcon } from '@/lib/iconSuggest'
import { ChevronLeft } from 'lucide-react'

async function createCategory(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string || null
  const parentCategoryId = formData.get('parent_id') as string || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const skuPrefix = (formData.get('sku_prefix') as string || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
  const isActive = formData.get('is_active') === 'true'
  const policyOverride = formData.get('policy_override') === 'true'
  const returnAllowed = policyOverride ? (formData.get('return_allowed') !== 'false') : null
  const returnWindowDays = policyOverride ? Math.max(1, parseInt(formData.get('return_window_days') as string) || 7) : null
  const replacementAllowed = policyOverride ? (formData.get('replacement_allowed') !== 'false') : null
  const replacementWindowDays = policyOverride ? Math.max(1, parseInt(formData.get('replacement_window_days') as string) || 7) : null
  const googleProductCategory = formData.get('google_product_category') as string || null

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const manualIcon = (formData.get('icon_name') as string || '').trim()
  const iconName = manualIcon || await suggestIcon(name)

  await query(
    `INSERT INTO categories (name, slug, description, parent_category_id, sku_prefix, display_order, is_active, google_product_category, icon_name, return_allowed, return_window_days, replacement_allowed, replacement_window_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [name, slug, description, parentCategoryId, skuPrefix, displayOrder, isActive, googleProductCategory, iconName, returnAllowed, returnWindowDays, replacementAllowed, replacementWindowDays]
  )

  revalidatePath('/admin/categories')
  revalidatePath('/admin/categories/add')
  revalidatePath('/admin/categories/edit/[id]', 'page')
  revalidatePath('/admin/products/add')
  revalidatePath('/admin/products/edit/[id]', 'page')

  redirect('/admin/categories')
}

export default async function AddCategoryPage() {
  const categories = await getAllCategories()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href="/admin/categories" className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Categories
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Add Category</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Category</h1>
        <p className="text-foreground-secondary mt-1">Create a new product category</p>
      </div>

      <CategoryForm
        categories={categories || []}
        action={createCategory}
      />
    </div>
  )
}
