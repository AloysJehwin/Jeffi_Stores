import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAllCategories } from '@/lib/queries'
import { supabaseAdmin } from '@/lib/supabase'
import CategoryForm from '@/components/admin/CategoryForm'

async function createCategory(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const description = formData.get('description') as string || null
  const parentCategoryId = formData.get('parent_id') as string || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const isActive = formData.get('is_active') === 'true'

  // Generate slug from name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    const { error } = await supabaseAdmin
      .from('categories')
      .insert({
        name,
        slug,
        description,
        parent_category_id: parentCategoryId,
        display_order: displayOrder,
        is_active: isActive,
      })

    if (error) throw error

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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-secondary-500">Add New Category</h1>
        <p className="text-gray-600 mt-1">Create a new product category</p>
      </div>

      <CategoryForm
        categories={categories || []}
        action={createCategory}
      />
    </div>
  )
}
