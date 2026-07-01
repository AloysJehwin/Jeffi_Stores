import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/db'
import BrandForm from '@/components/admin/BrandForm'
import { ChevronLeft } from 'lucide-react'

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
  const return_allowed = formData.get('return_allowed') !== 'false'
  const return_window_days = Math.max(1, parseInt(formData.get('return_window_days') as string) || 7)
  const replacement_allowed = formData.get('replacement_allowed') !== 'false'
  const replacement_window_days = Math.max(1, parseInt(formData.get('replacement_window_days') as string) || 7)

  try {
    const existing = await queryOne<any>('SELECT is_active FROM brands WHERE id = $1', [brandId])

    await query(
      `UPDATE brands SET name = $1, slug = $2, description = $3, website = $4, logo_url = $5, is_active = $6,
        return_allowed = $7, return_window_days = $8, replacement_allowed = $9, replacement_window_days = $10
       WHERE id = $11`,
      [name, slug, description, website, logo_url, is_active, return_allowed, return_window_days, replacement_allowed, replacement_window_days, brandId]
    )

    if (existing && existing.is_active !== is_active) {
      await query('UPDATE products SET is_active = $1 WHERE brand_id = $2', [is_active, brandId])
    }

    revalidatePath('/admin/brands')
    revalidatePath('/admin/products/add')
    revalidatePath('/admin/products/edit/[id]', 'page')

    const host = await getHost()
    const back = formData.get('_back') as string | null
    redirect(ap(back && back.startsWith('/admin/brands') ? back : '/admin/brands', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to update brand')
  }
}

export default async function EditBrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const { id } = await params
  const { back } = await searchParams
  const brand = await getBrand(id).catch(() => null)

  if (!brand) {
    notFound()
  }

  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/brands') ? back : '/admin/brands'
  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap(backUrl, host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Brands
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Edit Brand</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Edit Brand</h1>
        <p className="text-foreground-secondary mt-1">Update brand information</p>
      </div>

      <BrandForm brand={brand} action={updateBrand.bind(null, id)} backUrl={backUrl} />
    </div>
  )
}
