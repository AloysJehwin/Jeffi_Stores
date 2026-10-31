'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/shared/db'
import { categoryDrafts, publishCategoryDraft } from '@/lib/catalog/category-draft'
import { DraftConflictError, discardDraftRow, getDraftRow, saveDraftContent } from '@/lib/admin/draft-branches'
import { suggestIcon } from '@/lib/shared/icon-suggest'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { closeAfter, guardDraftAction } from '@/lib/admin/draft-locks'

// Keep the admin's open editor session's snapshot in step with the draft just saved.
// After a Save-as-Draft, Cancel should revert to the just-saved draft (A2), not the
// pre-session snapshot (A1). Never fails the enclosing save on error.
async function resnapshotCategorySession(lockId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'category', lockId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[category-edit] resnapshotSession failed for', lockId, err)
  }
}

const poolDb = { query: (t: string, p?: unknown[]) => query(t, p) } as any

/** draftId is the draft being edited (null for a create-draft category, edited in place). */
export async function updateCategory(categoryId: string, draftId: string | null, formData: FormData) {
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
  const imageUrl = ((formData.get('image_url') as string) || '').trim().slice(0, 500) || null
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const manualIcon = ((formData.get('icon_name') as string) || '').trim()
  const iconName = manualIcon || (await suggestIcon(name))
  const intent = formData.get('intent') as string | null

  const draftRow = draftId ? await getDraftRow(categoryDrafts, draftId) : null
  const hasDraft = !!draftRow && draftRow.category_id === categoryId
  const lockId = hasDraft ? draftId! : categoryId
  const editPath = `/admin/categories/${categoryId}/edit${hasDraft ? `?draft=${draftId}` : ''}`

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
    image_url: imageUrl,
  }

  const host = await getHost()
  const actor = await guardDraftAction('category', lockId, editPath, intent)

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
       replacement_window_days=$14, image_url=$16, updated_at=NOW() WHERE id=$15`,
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
        imageUrl,
      ]
    )
    if (publish) await closeAfter(actor, 'category', categoryId, 'published')
    revalidatePath('/admin/categories')
    redirect(ap('/admin/categories', host))
  }

  if (!hasDraft) redirect(ap(`/admin/categories/${categoryId}`, host))

  if (intent === 'discard') {
    await discardDraftRow(categoryDrafts, lockId)
    await closeAfter(actor, 'category', lockId, 'discarded')
    revalidatePath('/admin/categories')
    redirect(ap(`/admin/categories/${categoryId}`, host))
  }

  await saveDraftContent(categoryDrafts, poolDb, lockId, draftFields)

  if (intent === 'publish') {
    try {
      await publishCategoryDraft(lockId, { actor })
    } catch (err) {
      // Someone published overlapping edits since this draft started: resolve them in the merge dialog.
      if (err instanceof DraftConflictError) redirect(ap(`${editPath}&merge=1`, host))
      throw err
    }
    revalidatePath('/admin/categories')
    redirect(ap(`/admin/categories`, host))
  }

  // Save as Draft resnapshots so Cancel reverts to this just-saved state.
  await resnapshotCategorySession(lockId)
  revalidatePath(editPath)
  revalidatePath('/admin/categories')
  const back = formData.get('_back') as string | null
  redirect(ap(back && back.startsWith('/admin/categories') ? back : '/admin/categories', host))
}
