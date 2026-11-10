import { createOrderDraft } from '../../api/orders'
import type { ExistingOrder, PlaceOrderRequest } from './checkoutStore'

export type DraftResult = { ok: true; draftToken: string } | { ok: false; error: string; existing: ExistingOrder | null }

/** The checkout draft an online payment (Razorpay or UPI) is taken against; a 409 names the unpaid order in the way. */
export async function createDraftForRequest(r: PlaceOrderRequest): Promise<DraftResult> {
  const draft = await createOrderDraft({
    mode: r.mode,
    addressId: r.address.id,
    notes: r.notes,
    couponId: r.couponId,
    ...(r.intent ? { intent: r.intent } : {}),
  })
  if (draft.status === 409 && draft.data.existingOrderId) {
    return {
      ok: false,
      error: draft.data.error || 'You have an unpaid order.',
      existing: { id: draft.data.existingOrderId, orderNumber: draft.data.existingOrderNumber || '' },
    }
  }
  if (!draft.ok || !draft.data.draftToken) return { ok: false, error: draft.data.error || 'Failed to start payment', existing: null }
  return { ok: true, draftToken: draft.data.draftToken }
}
