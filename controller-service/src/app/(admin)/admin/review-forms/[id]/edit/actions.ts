'use server'

import { query } from '@/lib/shared/db'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'
import { actionActor, closeAfter, draftActionError } from '@/lib/admin/draft-locks'

export async function discardReviewFormDraft(formId: string) {
  const denied = await draftActionError('review_form', formId, 'discard')
  if (denied) throw new Error(denied)
  await query(`DELETE FROM review_form_drafts WHERE form_id = $1`, [formId])
  await closeAfter(await actionActor(), 'review_form', formId, 'discarded')
}

// Resnapshot the admin's open review_form session to the just-saved draft so
// a later Cancel reverts to A2, not the pre-session A1. Never fails the caller.
export async function resnapshotReviewFormSession(formId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'review_form', formId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[review-form-edit] resnapshotSession failed for', formId, err)
  }
}
