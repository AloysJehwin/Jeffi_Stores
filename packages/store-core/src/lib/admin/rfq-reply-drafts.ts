import type { DraftLockError } from '@jeffi/draft-locks'
import { withTransaction } from '@/lib/shared/db'
import { actorOf, announceDraftClosed, canDiscard, closeDraftLockTx, type DraftActor } from '@/lib/admin/draft-locks'

/** Drop the admin's reply draft on this RFQ and close its lock (inside the caller's transaction). */
export async function clearReplyDraft(
  client: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  admin: { adminId: string; role?: string; scopes?: string[] },
  rfqId: string,
  reason: 'discarded' | 'sent'
) {
  const r = await client.query(`DELETE FROM rfq_reply_drafts WHERE rfq_id = $1 AND admin_id = $2 RETURNING id`, [rfqId, admin.adminId])
  for (const row of r.rows) await closeDraftLockTx(client as any, actorOf(admin), 'rfq_reply', row.id, reason)
}

/** Discard one reply draft by id, whoever wrote it (canDiscard rules); the refusal, or null once gone. */
export async function discardReplyDraft(actor: DraftActor, draftId: string): Promise<DraftLockError | null> {
  const allowed = await canDiscard(actor, 'rfq_reply', draftId)
  if (!allowed.ok) return allowed.error
  let closed: Awaited<ReturnType<typeof closeDraftLockTx>> = null
  await withTransaction(async client => {
    const r = await client.query(`DELETE FROM rfq_reply_drafts WHERE id = $1`, [draftId])
    if (r.rowCount) closed = await closeDraftLockTx(client, actor, 'rfq_reply', draftId, 'discarded')
  })
  await announceDraftClosed(actor, 'rfq_reply', draftId, closed, 'discarded')
  return null
}
