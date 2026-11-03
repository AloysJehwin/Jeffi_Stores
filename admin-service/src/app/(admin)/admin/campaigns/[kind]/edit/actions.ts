'use server'

import { queryOne } from '@/lib/shared/db'
import { getAdminSession } from '@/lib/auth/admin-auth'
import { findOpenSession, resnapshotSession } from '@/lib/admin/editor-sessions'

// Keep the admin's open editor session's snapshot in step with the draft just saved.
// After a Save-as-Draft, Cancel should revert to the just-saved draft (A2), not the
// pre-session snapshot (A1). Never throws — logged and swallowed so the enclosing
// client-side save never fails on this bookkeeping step.
export async function resnapshotCampaignSession(kind: string): Promise<void> {
  try {
    const session = await getAdminSession()
    if (!session) return
    const row = await queryOne<{ campaign_id: string }>(
      `SELECT campaign_id FROM campaign_drafts WHERE kind = $1`,
      [kind]
    )
    if (!row) return
    const open = await findOpenSession(session.adminId, 'campaign', row.campaign_id)
    if (!open) return
    await resnapshotSession(open.id, session.adminId)
  } catch (err) {
    console.error('[campaign-edit] resnapshotSession failed for', kind, err)
  }
}
