'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/shared/db'
import { suggestIcon } from '@/lib/shared/icon-suggest'
import { resolveCategoryGoogleCategory } from '@/lib/catalog/google-taxonomy'
import { canUseAi } from '@/lib/auth/ai-scope'
import { actionActor, lockNewDraft } from '@/lib/admin/draft-locks'
import { applyCategoryProfile, reorderIntervalDays } from '@/lib/catalog/category-draft'
import { CATEGORY_PROFILE_FIELDS } from '@/lib/catalog/category-fields'
import { parseFields } from '@/lib/catalog/entity-fields'
import { triggerEntityEnrichment } from '@/lib/catalog/entity-enrichment'

const poolDb = { query: (t: string, p?: unknown[]) => query(t, p) } as any

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
  const actor = await actionActor()
  const googleProductCategory = await resolveCategoryGoogleCategory(formData.get('google_product_category') as string, {
    name,
    description,
    parentId: parentCategoryId,
    ai: !!actor?.role && canUseAi(actor.role, actor.scopes ?? [], 'categories:write'),
  })
  const imageUrl = ((formData.get('image_url') as string) || '').trim().slice(0, 500) || null
  const heroMobile = ((formData.get('hero_image_mobile') as string) || '').trim() || null
  const heroDesktop = ((formData.get('hero_image_desktop') as string) || '').trim() || null
  const reorderDays = reorderIntervalDays(formData.get('reorder_interval_days'))

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const manualIcon = ((formData.get('icon_name') as string) || '').trim()
  const iconName = manualIcon || (await suggestIcon(name))

  // Create-as-draft: is_draft = true (and is_active = false) so the category lives ONLY in the
  // Drafts section, never the live list or storefront nav. "Publish" flips is_draft = false.
  const created = await query<{ id: string }>(
    `INSERT INTO categories (name, slug, description, parent_category_id, sku_prefix, display_order, is_active, is_draft, google_product_category, icon_name, return_allowed, return_window_days, replacement_allowed, replacement_window_days, image_url, hero_image_mobile, hero_image_desktop, reorder_interval_days)
     VALUES ($1, $2, $3, $4, $5, $6, false, true, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
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
      imageUrl,
      heroMobile,
      heroDesktop,
      reorderDays,
    ]
  )

  if (created.rows[0]) {
    await applyCategoryProfile(poolDb, created.rows[0].id, parseFields(CATEGORY_PROFILE_FIELDS, formData))
    await lockNewDraft(actor, 'category', created.rows[0].id)
    await triggerEntityEnrichment('category', created.rows[0].id)
  }
  revalidatePath('/admin/categories')

  const host = await getHost()
  redirect(ap('/admin/categories', host))
}
