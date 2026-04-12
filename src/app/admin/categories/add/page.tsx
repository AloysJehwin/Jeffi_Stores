import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories } from '@/lib/queries'
import { query } from '@/lib/db'
import CategoryForm from '@/components/admin/CategoryForm'

async function createCategory(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string || null
  const parentCategoryId = formData.get('parent_id') as string || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const skuPrefix = (formData.get('sku_prefix') as string || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
  const isActive = formData.get('is_active') === 'true'
  const googleProductCategory = formData.get('google_product_category') as string || null

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    await query(
      `INSERT INTO categories (name, slug, description, parent_category_id, sku_prefix, display_order, is_active, google_product_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [name, slug, description, parentCategoryId, skuPrefix, displayOrder, isActive, googleProductCategory]
    )

    // Revalidate all pages that use categories
    revalidatePath('/admin/categories')
    revalidatePath('/admin/categories/add')
    revalidatePath('/admin/categories/edit/[id]', 'page')
    revalidatePath('/admin/products/add')
    revalidatePath('/admin/products/edit/[id]', 'page')

    redirect('/admin/categories')
  } catch (error) {
    console.error('Error creating category:', error)
    throw error
  }
}

export default async function AddCategoryPage() {
  const categories = await getAllCategories()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-secondary-500">Add New Category</h1>
        <p className="text-foreground-secondary mt-1">Create a new product category</p>
      </div>

      <CategoryForm
        categories={categories || []}
        action={createCategory}
      />
    </div>
  )
}
