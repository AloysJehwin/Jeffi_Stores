import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne, withTransaction } from '@/lib/db'
import BrandForm from '@/components/admin/BrandForm'
import { ChevronLeft } from 'lucide-react'
import type { PoolClient } from 'pg'
import { getAdminSession } from '@/lib/admin-auth'
import { hasScope } from '@/lib/scopes'

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
  const intent = formData.get('intent') as string | null
  const host = await getHost()

  const draftRow = await queryOne<{ brand_id: string }>(
    `SELECT brand_id FROM brand_drafts WHERE brand_id = $1`, [brandId]
  )
  const hasDraft = !!draftRow

  const draftFields = { name, slug, description, website, logo_url, is_active, return_allowed, return_window_days, replacement_allowed, replacement_window_days }

  try {
    if (hasDraft || intent === 'draft') {
      if (intent === 'discard') {
        await query(`DELETE FROM brand_drafts WHERE brand_id = $1`, [brandId])
        revalidatePath(`/admin/brands/edit/${brandId}`)
        redirect(ap(`/admin/brands/edit/${brandId}`, host))
      }

      await query(
        `INSERT INTO brand_drafts (brand_id, fields, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (brand_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
        [brandId, JSON.stringify(draftFields)]
      )

      if (intent === 'publish') {
        const prevIsActive = await queryOne<{ is_active: boolean }>('SELECT is_active FROM brands WHERE id = $1', [brandId])
        await withTransaction(async (client: PoolClient) => {
          await client.query(
            `UPDATE brands SET name=$1, slug=$2, description=$3, website=$4, logo_url=$5,
             is_active=$6, return_allowed=$7, return_window_days=$8,
             replacement_allowed=$9, replacement_window_days=$10, updated_at=NOW() WHERE id=$11`,
            [name, slug, description, website, logo_url, is_active, return_allowed, return_window_days, replacement_allowed, replacement_window_days, brandId]
          )
          if (prevIsActive && prevIsActive.is_active !== is_active) {
            await client.query('UPDATE products SET is_active=$1 WHERE brand_id=$2', [is_active, brandId])
          }
          await client.query('DELETE FROM brand_drafts WHERE brand_id=$1', [brandId])
        })
        revalidatePath('/admin/brands')
        redirect(ap('/admin/brands', host))
      }

      // Save as Draft always returns to the list.
      revalidatePath(`/admin/brands/edit/${brandId}`)
      revalidatePath('/admin/brands')
      const back = formData.get('_back') as string | null
      redirect(ap(back && back.startsWith('/admin/brands') ? back : '/admin/brands', host))
    }

    // Unreachable: no draft means the edit page redirected before rendering the
    // form. Defensive fallback — write to the draft only, never mutate the live brand.
    await query(
      `INSERT INTO brand_drafts (brand_id, fields, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (brand_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
      [brandId, JSON.stringify(draftFields)]
    )
    revalidatePath(`/admin/brands/edit/${brandId}`)
    redirect(ap(`/admin/brands/edit/${brandId}`, host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to update brand')
  }
}

export default async function EditBrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const { id } = await params
  const { back } = await searchParams
  const brand = await getBrand(id).catch(() => null)
  if (!brand) notFound()

  const host = await getHost()

  // Editing ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // brand with no draft (active or inactive) redirects to the detail page, where
  // the Edit button creates a draft first. The live brand is never edited directly.
  const draftRow = await queryOne<{ brand_id: string; fields: Record<string, unknown> }>(
    `SELECT brand_id, fields FROM brand_drafts WHERE brand_id = $1`, [id]
  )
  const isDraft = !!draftRow
  if (!isDraft) {
    redirect(ap(`/admin/brands/${id}`, host))
  }

  const brandForForm = draftRow?.fields ? { ...brand, ...draftRow.fields } : brand

  const session = await getAdminSession()
  const hasReturns = hasScope(session?.role ?? '', session?.scopes ?? [], 'returns:read')

  const backUrl = back && back.startsWith('/admin/brands') ? back : '/admin/brands'

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap(backUrl, host)} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Brands
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">{isDraft ? 'Edit Draft' : 'Edit Brand'}</span>
      </div>

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Changes are saved to draft. The live brand stays unchanged until you publish.</p>
          </div>
          <form action={updateBrand.bind(null, id)}>
            <input type="hidden" name="intent" value="discard" />
            <button type="submit" className="text-xs text-amber-600 hover:underline ml-4">Discard draft</button>
          </form>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">{isDraft ? 'Edit Draft' : 'Edit Brand'}</h1>
        <p className="text-foreground-secondary mt-1">{isDraft ? 'Changes are saved to the draft only' : 'Update brand information'}</p>
      </div>

      <BrandForm brand={brandForForm} action={updateBrand.bind(null, id)} backUrl={backUrl} isDraft={isDraft} hasReturns={hasReturns} />
    </div>
  )
}
