import { query } from '@/lib/shared/db'
import { withDraftCreate, type DraftActor } from '@/lib/admin/draft-locks'

const CLONE_SQL = `INSERT INTO offer_drafts (offer_id, fields, products)
       SELECT $1,
              to_jsonb(po) - 'id' - 'created_at' - 'updated_at',
              COALESCE((SELECT jsonb_agg(product_id) FROM product_offer_items WHERE offer_id = $1), '[]'::jsonb)
         FROM product_offers po WHERE po.id = $1
     ON CONFLICT (offer_id) DO NOTHING`

/**
 * Create the offer_drafts row for this offer by cloning the live state, if missing. With an actor
 * the draft lock is taken in the same transaction (throws DraftLockError if someone else holds it).
 */
export async function ensureOfferDraft(offerId: string, actor?: DraftActor): Promise<void> {
  if (!actor?.adminId) {
    await query(CLONE_SQL, [offerId])
    return
  }
  await withDraftCreate(actor, 'offer', offerId, db => db.query(CLONE_SQL, [offerId]))
}

/** Same, but inside an existing transaction client. */
export async function ensureOfferDraftTx(client: { query: (text: string, params?: any[]) => Promise<unknown> }, offerId: string): Promise<void> {
  await client.query(CLONE_SQL, [offerId])
}
