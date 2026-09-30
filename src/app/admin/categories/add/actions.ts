'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/shared/db'
import { suggestIcon } from '@/lib/shared/icon-suggest'

export async function createCategory(formData: FormData) {
  const name = formData.get('name') as string
  const description = (formData.get('description') as string) || null
  const parentCategoryId = (formData.get('parent_id') as string) || null
  const displayOrder = parseInt(formData.get('display_order') as string)
  const skuPrefix = ((formData.get('sku_prefix') as string) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
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

  // Create-as-draft: is_draft = true (and is_active = false) so the category lives ONLY in the
  // Drafts section, never the live list or storefront nav. "Publish" flips is_draft = false.
  await query<{ id: string }>(
    `INSERT INTO categories (name, slug, description, parent_category_id, sku_prefix, display_order, is_active, is_draft, google_product_category, icon_name, return_allowed, return_window_days, replacement_allowed, replacement_window_days)
     VALUES ($1, $2, $3, $4, $5, $6, false, true, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      name,
      slug,
      description,
      parentCategoryId,
      skuPrefix,
      displayOrder,
      googleProductCategory,
      iconName,
      returnAllowed,
      returnWindowDays,
      replacementAllowed,
      replacementWindowDays,
    ]
  )

  revalidatePath('/admin/categories')

  const host = await getHost()
  redirect(ap('/admin/categories', host))
}
