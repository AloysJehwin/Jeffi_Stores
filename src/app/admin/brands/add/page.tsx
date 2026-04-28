import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/db'
import BrandForm from '@/components/admin/BrandForm'

async function createBrand(formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const slug = formData.get('slug') as string || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const description = (formData.get('description') as string) || null
  const website = (formData.get('website') as string) || null
  const logo_url = (formData.get('logo_url') as string) || null
  const is_active = formData.get('is_active') === 'true'

  try {
    await query(
      `INSERT INTO brands (name, slug, description, website, logo_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, slug, description, website, logo_url, is_active]
    )

    revalidatePath('/admin/brands')
    revalidatePath('/admin/products/add')
    revalidatePath('/admin/products/edit/[id]', 'page')

    redirect('/admin/brands')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to create brand')
  }
}

export default async function AddBrandPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Add New Brand</h1>
        <p className="text-foreground-secondary mt-1">Create a new product brand</p>
      </div>

      <BrandForm action={createBrand} />
    </div>
  )
}
