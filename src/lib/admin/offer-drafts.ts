import type { PoolClient } from 'pg'
import { query } from '@/lib/shared/db'

/** Create the offer_drafts row for this offer by cloning the live state, if missing. */
export async function ensureOfferDraft(offerId: string): Promise<void> {
  await query(
    `INSERT INTO offer_drafts (offer_id, fields, products)
       SELECT $1,
              to_jsonb(po) - 'id' - 'created_at' - 'updated_at',
              COALESCE((SELECT jsonb_agg(product_id) FROM product_offer_items WHERE offer_id = $1), '[]'::jsonb)
         FROM product_offers po WHERE po.id = $1
     ON CONFLICT (offer_id) DO NOTHING`,
    [offerId]
  )
}

/** Same, but inside an existing transaction client. */
export async function ensureOfferDraftTx(client: PoolClient, offerId: string): Promise<void> {
  await client.query(
    `INSERT INTO offer_drafts (offer_id, fields, products)
       SELECT $1,
              to_jsonb(po) - 'id' - 'created_at' - 'updated_at',
              COALESCE((SELECT jsonb_agg(product_id) FROM product_offer_items WHERE offer_id = $1), '[]'::jsonb)
         FROM product_offers po WHERE po.id = $1
     ON CONFLICT (offer_id) DO NOTHING`,
    [offerId]
  )
}
