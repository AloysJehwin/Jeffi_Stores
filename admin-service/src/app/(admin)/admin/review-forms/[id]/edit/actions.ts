'use server'

import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { actionActor, closeAfter, draftActionError } from '@/lib/admin/draft-locks'
import { discardDraftRow, getDraftRow } from '@/lib/admin/draft-branches'
import { reviewFormDrafts } from '@/lib/catalog/review-form-draft'

export async function discardReviewFormDraft(formId: string, draftId: string) {
  const row = await getDraftRow(reviewFormDrafts, draftId)
  if (!row || row.form_id !== formId) return
  const denied = await draftActionError('review_form', draftId, 'discard')
  if (denied) throw new Error(denied)
  await discardDraftRow(reviewFormDrafts, draftId)
  await closeAfter(await actionActor(), 'review_form', draftId, 'discarded')
}

// Resnapshot the admin's open review_form session to the just-saved draft so
// a later Cancel reverts to A2, not the pre-session A1. Never fails the caller.
export async function resnapshotReviewFormSession(lockId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'review_form', lockId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[review-form-edit] resnapshotSession failed for', lockId, err)
  }
}
