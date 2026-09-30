'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne, withTransaction } from '@/lib/db'
import type { PoolClient } from 'pg'

export async function updateBrand(brandId: string, formData: FormData) {
  const name = formData.get('name') as string
  const slug =
    (formData.get('slug') as string) ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
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

  const draftRow = await queryOne<{ brand_id: string }>(`SELECT brand_id FROM brand_drafts WHERE brand_id = $1`, [
    brandId,
  ])
  const hasDraft = !!draftRow

  const draftFields = {
    name,
    slug,
    description,
    website,
    logo_url,
    is_active,
    return_allowed,
    return_window_days,
    replacement_allowed,
    replacement_window_days,
  }

  // Create-draft brand (is_draft = true, no brand_drafts row): edit the row in place, never
  // through brand_drafts. Save keeps it a draft; Publish flips is_draft = false + is_active.
  const createDraftRow = await queryOne<{ is_draft: boolean }>(`SELECT is_draft FROM brands WHERE id = $1`, [brandId])
  if (!hasDraft && createDraftRow?.is_draft) {
    const publish = intent === 'publish'
    await query(
      `UPDATE brands SET name=$1, slug=$2, description=$3, website=$4, logo_url=$5,
       is_active=$6, is_draft=$7, return_allowed=$8, return_window_days=$9,
       replacement_allowed=$10, replacement_window_days=$11 WHERE id=$12`,
      [
        name,
        slug,
        description,
        website,
        logo_url,
        publish ? true : false,
        publish ? false : true,
        return_allowed,
        return_window_days,
        replacement_allowed,
        replacement_window_days,
        brandId,
      ]
    )
    revalidatePath('/admin/brands')
    redirect(ap('/admin/brands', host))
  }

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
        const prevIsActive = await queryOne<{ is_active: boolean }>('SELECT is_active FROM brands WHERE id = $1', [
          brandId,
        ])
        await withTransaction(async (client: PoolClient) => {
          await client.query(
            `UPDATE brands SET name=$1, slug=$2, description=$3, website=$4, logo_url=$5,
             is_active=$6, return_allowed=$7, return_window_days=$8,
             replacement_allowed=$9, replacement_window_days=$10, updated_at=NOW() WHERE id=$11`,
            [
              name,
              slug,
              description,
              website,
              logo_url,
              is_active,
              return_allowed,
              return_window_days,
              replacement_allowed,
              replacement_window_days,
              brandId,
            ]
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
