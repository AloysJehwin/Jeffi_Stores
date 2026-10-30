'use server'

import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'

// Keep the admin's open editor session's snapshot in step with the draft just saved.
// After a Save-as-Draft, Cancel should revert to the just-saved draft (A2), not the
// pre-session snapshot (A1). Never fails the enclosing save on error.
export async function resnapshotSupplierSession(draftId: string) {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'supplier', draftId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[supplier-edit] resnapshotSession failed for', draftId, err)
  }
}
