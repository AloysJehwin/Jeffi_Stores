'use server'

import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'

// Keep the admin's open po_receive session's snapshot in step with the just-saved
// receive draft. After a Save-as-Draft, a later Cancel should revert to the just-saved
// draft (A2), not the pre-session snapshot (A1). Never fails the enclosing save on error.
export async function resnapshotPoReceiveSession(poId: string): Promise<void> {
  try {
    const session = await getAdminSession()
    if (!session) return
    const open = await findOpenSession(session.adminId, 'po_receive', poId)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[po-receive] resnapshotSession failed for', poId, err)
  }
}
