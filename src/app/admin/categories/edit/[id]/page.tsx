import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { ap } from '@/lib/admin-path'
import { revalidatePath } from 'next/cache'
import { getAllCategories } from '@/lib/queries'
import { query, queryOne } from '@/lib/db'
import CategoryForm from '@/components/admin/CategoryForm'
import { suggestIcon } from '@/lib/iconSuggest'
import { ChevronLeft } from 'lucide-react'

async function getCategory(id: string) {
  const data = await queryOne('SELECT * FROM categories WHERE id = $1', [id])
  if (!data) throw new Error('Category not found')
  return data
}

async function updateCategory(categoryId: string, formData: FormData) {
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
    `UPDATE categories SET
      name = $1, slug = $2, description = $3, parent_category_id = $4,
      sku_prefix = $5, display_order = $6, is_active = $7, google_product_category = $8,
      icon_name = $9, return_allowed = $10, return_window_days = $11,
      replacement_allowed = $12, replacement_window_days = $13, updated_at = $14
    WHERE id = $15`,
    [name, slug, description, parentCategoryId, skuPrefix, displayOrder, isActive, googleProductCategory, iconName, returnAllowed, returnWindowDays, replacementAllowed, replacementWindowDays, new Date().toISOString(), categoryId]
  )

  revalidatePath('/admin/categories')
  revalidatePath('/admin/categories/add')
  revalidatePath('/admin/categories/edit/[id]', 'page')
  revalidatePath('/admin/products/add')
  revalidatePath('/admin/products/edit/[id]', 'page')

  const { headers: getHeaders } = await import('next/headers')
  const host = (await getHeaders()).get('host') ?? ''
  redirect(ap('/admin/categories', host))
}

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const category = await getCategory(id).catch(() => null)

  if (!category) {
    notFound()
  }

  const host = (await headers()).get('host') ?? ''
  const categories = await getAllCategories()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap('/admin/categories', host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Categories
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Edit Category</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Edit Category</h1>
        <p className="text-foreground-secondary mt-1">Update category information</p>
      </div>

      <CategoryForm
        categories={categories || []}
        category={category}
        action={updateCategory.bind(null, id)}
      />
    </div>
  )
}
