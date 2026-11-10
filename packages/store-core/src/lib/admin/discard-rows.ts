import { NextResponse } from 'next/server'
import { query, queryCount, queryOne } from '@/lib/shared/db'
import { campaignLockId, canDiscard, closeAfter, closeIfLocked, type DraftActor, type DraftResourceType } from './draft-locks'

// The deletes behind each draft type's discard, shared by the type's own route and the Drafts
// dashboard (draft-discard.ts). Each one checks canDiscard at the point its route always did.

export type DiscardResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> }

export const discarded: DiscardResult = { ok: true }
export const refused = (status: number, error: string): DiscardResult => ({ ok: false, status, body: { error } })

/** canDiscard as a 423 result, or null when allowed (an owner override is audited, holder notified). */
export async function discardRefusal(actor: DraftActor, type: DraftResourceType, id: string): Promise<DiscardResult | null> {
  const r = await canDiscard(actor, type, id)
  return r.ok ? null : { ok: false, status: 423, body: r.error.body() }
}

export function discardReply(r: DiscardResult, body: Record<string, unknown> = { success: true }): NextResponse {
  return r.ok ? NextResponse.json(body) : NextResponse.json(r.body, { status: r.status })
}

/** Delete a brand (also a never-published brand's discard): not while products use it. */
export async function deleteBrandRow(actor: DraftActor, id: string): Promise<DiscardResult> {
  const productCount = await queryCount('SELECT COUNT(*) FROM products WHERE brand_id = $1', [id])
  if (productCount > 0) return refused(400, `Cannot delete brand. It has ${productCount} product(s) assigned to it.`)
  const denied = await discardRefusal(actor, 'brand', id)
  if (denied) return denied
  await query('DELETE FROM brands WHERE id = $1', [id])
  await closeIfLocked(actor, 'brand', id)
  return discarded
}

/** Delete a category (also a never-published category's discard): not with products or subcategories. */
export async function deleteCategoryRow(actor: DraftActor, id: string): Promise<DiscardResult> {
  const productCount = await queryCount('SELECT COUNT(*) FROM products WHERE category_id = $1', [id])
  if (productCount > 0) return refused(400, `Cannot delete category. It has ${productCount} product(s) assigned to it.`)
  const subCategoryCount = await queryCount('SELECT COUNT(*) FROM categories WHERE parent_category_id = $1', [id])
  if (subCategoryCount > 0) return refused(400, `Cannot delete category. It has ${subCategoryCount} subcategory(ies).`)
  const denied = await discardRefusal(actor, 'category', id)
  if (denied) return denied
  await query('DELETE FROM categories WHERE id = $1', [id])
  await closeIfLocked(actor, 'category', id)
  return discarded
}

/** Delete a coupon (also a never-published coupon's discard): not while a review form uses it. */
export async function deleteCouponRow(actor: DraftActor, id: string): Promise<DiscardResult> {
  const inUse = await queryOne('SELECT id FROM review_forms WHERE coupon_id = $1 LIMIT 1', [id])
  if (inUse) return refused(409, 'Coupon is used by a review form — remove it from the form first')
  const denied = await discardRefusal(actor, 'coupon', id)
  if (denied) return denied
  // Unlink from campaigns before deleting to avoid FK violation
  await query('UPDATE campaigns SET coupon_id = NULL WHERE coupon_id = $1', [id])
  await queryOne('DELETE FROM coupons WHERE id = $1', [id])
  await closeIfLocked(actor, 'coupon', id)
  return discarded
}

/** Delete a review form (also a never-published form's discard). */
export async function deleteReviewFormRow(actor: DraftActor, id: string): Promise<DiscardResult> {
  const denied = await discardRefusal(actor, 'review_form', id)
  if (denied) return denied
  await queryOne('DELETE FROM review_forms WHERE id = $1', [id])
  await closeIfLocked(actor, 'review_form', id)
  return discarded
}

/** Delete a mailer message; deleting a draft is a discard (holder, or an owner role, audited). */
export async function deleteMailerMessage(actor: DraftActor, id: string): Promise<DiscardResult> {
  const campaign = await queryOne<{ status: string }>('SELECT status FROM email_campaigns WHERE id = $1', [id])
  if (!campaign) return refused(404, 'Not found')
  if (campaign.status === 'sending') return refused(400, 'Cannot delete a campaign while it is sending')
  const lockActor = campaign.status === 'draft' ? actor : null
  const denied = await discardRefusal(lockActor, 'mailer', id)
  if (denied) return denied
  await query('DELETE FROM email_campaigns WHERE id = $1', [id])
  if (lockActor) await closeIfLocked(lockActor, 'mailer', id, 'discarded')
  return discarded
}

/** Clear a campaign's draft (the row stays so campaign_id stays stable for sessions). */
export async function discardCampaignDraft(actor: DraftActor, kind: string): Promise<DiscardResult> {
  const lockId = actor ? await campaignLockId(kind) : null
  if (lockId) {
    const denied = await discardRefusal(actor, 'campaign', lockId)
    if (denied) return denied
  }
  await query(`UPDATE campaign_drafts SET fields = '{}'::jsonb, updated_at = now() WHERE kind = $1`, [kind])
  if (lockId) await closeAfter(actor, 'campaign', lockId, 'discarded')
  return discarded
}
