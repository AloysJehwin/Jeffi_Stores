'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { ensureOfferDraft } from '@/lib/admin/offer-drafts'

// Create (or reuse) the offer_drafts row for this offer, then redirect to /edit.
// Mirrors startCouponDraft / startBrandDraft; the edit page's own guard sends
// users back here when no draft exists, so this is the single entry to editing.
export async function startOfferDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  await ensureOfferDraft(id)
  const host = await getHost()
  const qs = back ? `?back=${encodeURIComponent(back)}` : ''
  redirect(ap(`/admin/offers/${id}/edit${qs}`, host))
}
