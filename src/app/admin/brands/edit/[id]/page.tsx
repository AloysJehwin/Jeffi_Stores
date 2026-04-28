import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/db'
import BrandForm from '@/components/admin/BrandForm'

async function getBrand(id: string) {
  const data = await queryOne('SELECT * FROM brands WHERE id = $1', [id])
  if (!data) throw new Error('Brand not found')
  return data
}

async function updateBrand(brandId: string, formData: FormData) {
  'use server'

  const name = formData.get('name') as string
  const slug = formData.get('slug') as string || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const description = (formData.get('description') as string) || null
  const website = (formData.get('website') as string) || null
  const logo_url = (formData.get('logo_url') as string) || null
  const is_active = formData.get('is_active') === 'true'

  try {
    await query(
      `UPDATE brands SET name = $1, slug = $2, description = $3, website = $4, logo_url = $5, is_active = $6
       WHERE id = $7`,
      [name, slug, description, website, logo_url, is_active, brandId]
    )

    revalidatePath('/admin/brands')
    revalidatePath('/admin/products/add')
    revalidatePath('/admin/products/edit/[id]', 'page')

    redirect('/admin/brands')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to update brand')
  }
}

export default async function EditBrandPage({ params }: { params: { id: string } }) {
  const brand = await getBrand(params.id).catch(() => null)

  if (!brand) {
    notFound()
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Edit Brand</h1>
        <p className="text-foreground-secondary mt-1">Update brand information</p>
      </div>

      <BrandForm brand={brand} action={updateBrand.bind(null, params.id)} />
    </div>
  )
}
