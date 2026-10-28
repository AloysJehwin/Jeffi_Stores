import { actorOf, closeDraftLockTx } from '@/lib/admin/draft-locks'

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
