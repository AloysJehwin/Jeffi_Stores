import { DRAFT_RESOURCES, isDraftLockError, type DraftLockError, type DraftResourceType } from '@jeffi/draft-locks'
import { query, queryOne } from '@/lib/shared/db'
import { docServiceFetch } from '@/lib/documents/proxy'
import { brandDrafts } from '@/lib/catalog/brand-draft'
import { categoryDrafts } from '@/lib/catalog/category-draft'
import { couponDrafts } from '@/lib/catalog/coupon-draft'
import { reviewFormDrafts } from '@/lib/catalog/review-form-draft'
import { discardHomepageDraft } from '@/lib/catalog/homepage-draft'
import { discardProductDraft } from '@/lib/catalog/product-draft-discard'
import { SCENARIO_DRAFTS } from '@/lib/campaigns/scenario-drafts'
import { ADS_CAMPAIGN_DRAFTS } from '@/lib/google-ads/campaign-drafts'
import { closeAfter, closeIfLocked, type DraftActor } from './draft-locks'
import { discardDraftRow, getDraftRow, type DraftAdapter } from './draft-branches'
import { offerDrafts } from './offer-drafts'
import { supplierDrafts } from './supplier-drafts'
import { discardJsonDraft } from './json-drafts'
import { discardReplyDraft } from './rfq-reply-drafts'
import {
  deleteBrandRow,
  deleteCategoryRow,
  deleteCouponRow,
  deleteMailerMessage,
  deleteReviewFormRow,
  discardCampaignDraft,
  discardRefusal,
  discarded,
  refused,
  type DiscardResult,
} from './discard-rows'

export type { DiscardResult } from './discard-rows'

type Discard = (actor: NonNullable<DraftActor>, id: string) => Promise<DiscardResult>

const lockResult = (e: DraftLockError | null): DiscardResult => (e ? { ok: false, status: 423, body: e.body() } : discarded)

/** An edit draft (branch) as its draft route discards it; `whole` handles a never-published entity's own row. */
const branch =
  (a: DraftAdapter, whole?: Discard): Discard =>
  async (actor, id) => {
    if (!(await getDraftRow(a, id))) return whole ? whole(actor, id) : refused(404, 'Draft not found')
    const denied = await discardRefusal(actor, a.type, id)
    if (denied) return denied
    await discardDraftRow(a, id)
    await closeAfter(actor, a.type, id, 'discarded')
    return discarded
  }

/** Invoice / quotation / PO / held-bill drafts live in document-service: its own discard decides (same rules). */
const docs =
  (path: (id: string) => string, method = 'DELETE', body?: unknown): Discard =>
  async (actor, id) => {
    const res = await docServiceFetch(path(id), { adminId: actor.adminId, role: actor.role, scopes: actor.scopes ?? [] }, { method, body })
    if (res.ok) return discarded
    const data = await res.json().catch(() => null)
    return { ok: false, status: res.status, body: data && typeof data === 'object' ? data : { error: 'Could not delete the draft' } }
  }

// Each type's own discard (what its editor's Discard / Delete calls).
const DISCARD: Record<DraftResourceType, Discard> = {
  product: async (actor, id) => {
    const row = await queryOne<{ product_id: string }>(`SELECT product_id FROM product_drafts WHERE id = $1`, [id])
    return discardProductDraft(actor, row ? row.product_id : id, row ? id : null)
  },
  brand: branch(brandDrafts, deleteBrandRow),
  category: branch(categoryDrafts, deleteCategoryRow),
  coupon: branch(couponDrafts, deleteCouponRow),
  review_form: branch(reviewFormDrafts, deleteReviewFormRow),
  supplier: branch(supplierDrafts),
  offer: branch(offerDrafts),
  campaign: async (actor, id) => {
    const row = await queryOne<{ kind: string }>(`SELECT kind FROM campaign_drafts WHERE campaign_id = $1`, [id])
    return row ? discardCampaignDraft(actor, row.kind) : refused(404, 'Draft not found')
  },
  homepage: async (actor, id) => {
    try {
      return (await discardHomepageDraft(id, { actor })) ? discarded : refused(404, 'Draft not found')
    } catch (err) {
      if (isDraftLockError(err)) return lockResult(err)
      throw err
    }
  },
  mailer: deleteMailerMessage,
  invoice: docs(id => `/admin/invoices/drafts/${id}`),
  quotation: docs(id => `/admin/quotations/${id}`),
  // A draft PO's own page cancels it (its discard); nothing was sent yet.
  purchase_order: docs(id => `/admin/inventory/po/${id}`, 'PATCH', { status: 'cancelled' }),
  po_new: docs(id => `/admin/inventory/po/draft/${id}`),
  po_receive: docs(id => `/admin/inventory/po/${id}/receive/draft`),
  cash_sale: docs(id => `/admin/invoices/cash-sale/drafts/${id}`),
  scenario: async (actor, id) => lockResult(await discardJsonDraft(SCENARIO_DRAFTS, actor, id)),
  google_ads_campaign: async (actor, id) => lockResult(await discardJsonDraft(ADS_CAMPAIGN_DRAFTS, actor, id)),
  rfq_reply: async (actor, id) => lockResult(await discardReplyDraft(actor, id)),
}

/**
 * Delete a draft of any registered type through that type's own discard: the holder, an unclaimed
 * draft, or an owner role (audited, holder notified). The lock closes and is announced with it.
 */
export async function discardDraft(actor: NonNullable<DraftActor>, type: DraftResourceType, id: string): Promise<DiscardResult> {
  const found = await query(DRAFT_RESOURCES[type].existsSql, [id])
  if (!found.rowCount) {
    // A lock outliving its draft: close it so the Drafts list drops the row.
    await closeIfLocked(actor, type, id, 'orphaned')
    return refused(404, 'Draft not found')
  }
  return DISCARD[type](actor, id)
}
