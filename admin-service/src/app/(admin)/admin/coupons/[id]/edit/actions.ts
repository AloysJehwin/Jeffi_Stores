'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { revalidatePath } from 'next/cache'
import { query } from '@/lib/shared/db'
import { couponDrafts, publishCouponDraft } from '@/lib/catalog/coupon-draft'
import { DraftConflictError, discardDraftRow, getDraftRow, saveDraftContent } from '@/lib/admin/draft-branches'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { closeAfter, guardDraftAction } from '@/lib/admin/draft-locks'

// Keep the admin's open editor session's snapshot in step with the draft just saved.
// After a Save-as-Draft, Cancel should revert to the just-saved draft (A2), not the
// pre-session snapshot (A1). Never fails the enclosing save on error.
async function resnapshotCouponSession(lockId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'coupon', lockId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[coupon-edit] resnapshotSession failed for', lockId, err)
  }
}

const poolDb = { query: (t: string, p?: unknown[]) => query(t, p) } as any

/** draftId is the coupon draft being edited (a coupon is always edited through one). */
export async function updateCoupon(id: string, draftId: string | null, formData: FormData) {
  // The discard form posts only `intent`, so code is missing there.
  const code = ((formData.get('code') as string | null) ?? '').toUpperCase().trim()
  const description = formData.get('description') as string
  const discount_type = formData.get('discount_type') as string
  const discount_value = parseFloat(formData.get('discount_value') as string)
  const min_purchase_amount = formData.get('min_purchase_amount')
    ? parseFloat(formData.get('min_purchase_amount') as string)
    : null
  const max_discount_amount = formData.get('max_discount_amount')
    ? parseFloat(formData.get('max_discount_amount') as string)
    : null
  const usage_limit = formData.get('usage_limit') ? parseInt(formData.get('usage_limit') as string, 10) : null
  const usage_limit_per_user = formData.get('usage_limit_per_user')
    ? parseInt(formData.get('usage_limit_per_user') as string, 10)
    : null
  const valid_from = formData.get('valid_from') || null
  const valid_until = formData.get('valid_until') || null
  const is_active = formData.get('is_active') === 'true'
  const intent = formData.get('intent') as string | null
  const host = await getHost()
  const draftRow = draftId ? await getDraftRow(couponDrafts, draftId) : null
  const hasDraft = !!draftRow && draftRow.coupon_id === id
  const lockId = hasDraft ? draftId! : id
  const editPath = `/admin/coupons/${id}/edit${hasDraft ? `?draft=${draftId}` : ''}`
  const actor = await guardDraftAction('coupon', lockId, editPath, intent)
  const rawBack = formData.get('_back') as string | null
  const destination = rawBack && rawBack.startsWith('/admin/coupons') ? rawBack : '/admin/coupons'

  const draftFields = {
    code,
    description: description || null,
    discount_type,
    discount_value,
    min_purchase_amount,
    max_discount_amount,
    usage_limit,
    usage_limit_per_user,
    valid_from,
    valid_until,
    is_active,
  }

  if (!hasDraft) redirect(ap(`/admin/coupons/${id}/view`, host))

  try {
    if (intent === 'discard') {
      await discardDraftRow(couponDrafts, lockId)
      await closeAfter(actor, 'coupon', lockId, 'discarded')
      revalidatePath(`/admin/coupons/${id}/view`)
      revalidatePath('/admin/coupons')
      redirect(ap(`/admin/coupons/${id}/view`, host))
    }

    // Publishing activates the coupon — a create-draft (is_draft=true) moves out of the Drafts
    // section onto the live list. The admin can deactivate afterwards from the live list.
    if (intent === 'publish') draftFields.is_active = true
    await saveDraftContent(couponDrafts, poolDb, lockId, draftFields)

    if (intent === 'publish') {
      try {
        await publishCouponDraft(lockId, { actor })
      } catch (err) {
        // Someone published overlapping edits since this draft started: resolve them in the merge dialog.
        if (err instanceof DraftConflictError) redirect(ap(`${editPath}&merge=1`, host))
        throw err
      }
      revalidatePath('/admin/coupons')
      redirect(ap('/admin/coupons', host))
    }

    // Save as Draft (intent === 'draft'): resnapshot so a later Cancel reverts to this exact state (A2),
    // not the pre-session snapshot (A1). Session stays open; next edit resumes it.
    await resnapshotCouponSession(lockId)

    revalidatePath(editPath)
    revalidatePath('/admin/coupons')
    redirect(ap(destination, host))
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT') || err?.type === 'NEXT_REDIRECT') throw err
    throw new Error(err?.message || 'Failed to update coupon')
  }
}
