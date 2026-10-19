'use server'

import { query } from '@/lib/shared/db'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'

export async function discardReviewFormDraft(formId: string) {
  await query(`DELETE FROM review_form_drafts WHERE form_id = $1`, [formId])
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
