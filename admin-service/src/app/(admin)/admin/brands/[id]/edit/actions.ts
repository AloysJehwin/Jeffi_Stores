'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query, queryOne } from '@/lib/shared/db'
import { brandDrafts, publishBrandDraft } from '@/lib/catalog/brand-draft'
import { DraftConflictError, discardDraftRow, getDraftRow, saveDraftContent } from '@/lib/admin/draft-branches'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { closeAfter, guardDraftAction } from '@/lib/admin/draft-locks'

// Keep the admin's open editor session's snapshot in step with the draft just saved.
// After a Save-as-Draft, Cancel should revert to the just-saved draft (A2), not the
// pre-session snapshot (A1). Never fails the enclosing save on error.
async function resnapshotBrandSession(lockId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'brand', lockId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[brand-edit] resnapshotSession failed for', lockId, err)
  }
}

const poolDb = { query: (t: string, p?: unknown[]) => query(t, p) } as any

/** draftId is the draft being edited (null for a create-draft brand, edited in place). */
export async function updateBrand(brandId: string, draftId: string | null, formData: FormData) {
  // The discard-draft form posts only `intent`, so name is missing there.
  const name = ((formData.get('name') as string | null) ?? '').trim()
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
  const draftRow = draftId ? await getDraftRow(brandDrafts, draftId) : null
  const hasDraft = !!draftRow && draftRow.brand_id === brandId
  const lockId = hasDraft ? draftId! : brandId
  const editPath = `/admin/brands/${brandId}/edit${hasDraft ? `?draft=${draftId}` : ''}`
  const actor = await guardDraftAction('brand', lockId, editPath, intent)

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

  // Create-draft brand (is_draft = true, no draft row): edit the row in place, never
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
    if (publish) await closeAfter(actor, 'brand', brandId, 'published')
    // Save-as-Draft on a create-draft: resnapshot so Cancel reverts here.
    else await resnapshotBrandSession(brandId)
    // Publish → /view (new standardized destination); save-as-draft stays on list.
    redirect(ap(publish ? `/admin/brands/${brandId}/view` : '/admin/brands', host))
  }

  if (!hasDraft) redirect(ap(`/admin/brands/${brandId}/view`, host))

  if (intent === 'discard') {
    await discardDraftRow(brandDrafts, lockId)
    await closeAfter(actor, 'brand', lockId, 'discarded')
    revalidatePath('/admin/brands')
    redirect(ap(`/admin/brands/${brandId}/view`, host))
  }

  try {
    await saveDraftContent(brandDrafts, poolDb, lockId, draftFields)

    if (intent === 'publish') {
      try {
        await publishBrandDraft(lockId, { actor })
      } catch (err) {
        // Someone published overlapping edits since this draft started: resolve them in the merge dialog.
        if (err instanceof DraftConflictError) redirect(ap(`${editPath}&merge=1`, host))
        throw err
      }
      revalidatePath('/admin/brands')
      redirect(ap('/admin/brands', host))
    }

    // Save as Draft: resnapshot so Cancel reverts to this save (A2), not the pre-session (A1).
    await resnapshotBrandSession(lockId)
    revalidatePath(editPath)
    revalidatePath('/admin/brands')
    const back = formData.get('_back') as string | null
    redirect(ap(back && back.startsWith('/admin/brands') ? back : '/admin/brands', host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    throw new Error('Failed to update brand')
  }
}
