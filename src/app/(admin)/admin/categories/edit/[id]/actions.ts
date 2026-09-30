'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/shared/db'
import { publishCategoryDraft } from '@/lib/catalog/category-draft'
import { suggestIcon } from '@/lib/shared/icon-suggest'

export async function updateCategory(categoryId: string, formData: FormData) {
  const name = formData.get('name') as string
  const description = (formData.get('description') as string) || null
  const parentCategoryId = (formData.get('parent_id') as string) || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const skuPrefix = ((formData.get('sku_prefix') as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
  const isActive = formData.get('is_active') === 'true'
  const policyOverride = formData.get('policy_override') === 'true'
  const returnAllowed = policyOverride ? formData.get('return_allowed') !== 'false' : null
  const returnWindowDays = policyOverride
    ? Math.max(1, parseInt(formData.get('return_window_days') as string) || 7)
    : null
  const replacementAllowed = policyOverride ? formData.get('replacement_allowed') !== 'false' : null
  const replacementWindowDays = policyOverride
    ? Math.max(1, parseInt(formData.get('replacement_window_days') as string) || 7)
    : null
  const googleProductCategory = (formData.get('google_product_category') as string) || null
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const manualIcon = ((formData.get('icon_name') as string) || '').trim()
  const iconName = manualIcon || (await suggestIcon(name))
  const intent = formData.get('intent') as string | null

  const draftRow = await queryOne<{ category_id: string }>(
    `SELECT category_id FROM category_drafts WHERE category_id = $1`,
    [categoryId]
  )
  const hasDraft = !!draftRow

  const draftFields = {
    name,
    slug,
    description,
    parent_category_id: parentCategoryId,
    display_order: displayOrder,
    sku_prefix: skuPrefix,
    is_active: isActive,
    policy_override: policyOverride,
    return_allowed: returnAllowed,
    return_window_days: returnWindowDays,
    replacement_allowed: replacementAllowed,
    replacement_window_days: replacementWindowDays,
    google_product_category: googleProductCategory,
    icon_name: iconName,
  }

  const host = await getHost()

  // Create-draft category (is_draft = true, no category_drafts row): edit the row in place.
  // Save keeps it a draft; Publish flips is_draft = false + is_active.
  const createDraftRow = await queryOne<{ is_draft: boolean }>(`SELECT is_draft FROM categories WHERE id = $1`, [
    categoryId,
  ])
  if (!hasDraft && createDraftRow?.is_draft) {
    const publish = intent === 'publish'
    await query(
      `UPDATE categories SET name=$1, slug=$2, description=$3, parent_category_id=$4,
       display_order=$5, sku_prefix=$6, is_active=$7, is_draft=$8, google_product_category=$9,
       icon_name=$10, return_allowed=$11, return_window_days=$12, replacement_allowed=$13,
       replacement_window_days=$14, updated_at=NOW() WHERE id=$15`,
      [
        name,
        slug,
        description,
        parentCategoryId,
        displayOrder,
        skuPrefix,
        publish ? true : false,
        publish ? false : true,
        googleProductCategory,
        iconName,
        returnAllowed,
        returnWindowDays,
        replacementAllowed,
        replacementWindowDays,
        categoryId,
      ]
    )
    revalidatePath('/admin/categories')
    redirect(ap('/admin/categories', host))
  }

  if (hasDraft || intent === 'draft') {
    if (intent === 'discard') {
      await query(`DELETE FROM category_drafts WHERE category_id = $1`, [categoryId])
      revalidatePath(`/admin/categories/edit/${categoryId}`)
      redirect(ap(`/admin/categories/edit/${categoryId}`, host))
    }

    // Save to draft
    await query(
      `INSERT INTO category_drafts (category_id, fields, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (category_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
      [categoryId, JSON.stringify(draftFields)]
    )

    if (intent === 'publish') {
      await publishCategoryDraft(categoryId)
      revalidatePath('/admin/categories')
      revalidatePath(`/admin/categories/edit/${categoryId}`)
      redirect(ap(`/admin/categories`, host))
    }

    // Save as Draft always returns to the list.
    revalidatePath(`/admin/categories/edit/${categoryId}`)
    revalidatePath('/admin/categories')
    const back = formData.get('_back') as string | null
    redirect(ap(back && back.startsWith('/admin/categories') ? back : '/admin/categories', host))
  }

  // Unreachable: no draft means the edit page redirected before rendering the form.
  // Defensive fallback — write to the draft only, never mutate the live category.
  // (The is_active → products/subcategories cascade lives in publishCategoryDraft.)
  await query(
    `INSERT INTO category_drafts (category_id, fields, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (category_id) DO UPDATE SET fields = EXCLUDED.fields, updated_at = NOW()`,
    [categoryId, JSON.stringify(draftFields)]
  )
  revalidatePath(`/admin/categories/edit/${categoryId}`)
  redirect(ap(`/admin/categories/edit/${categoryId}`, host))
}
