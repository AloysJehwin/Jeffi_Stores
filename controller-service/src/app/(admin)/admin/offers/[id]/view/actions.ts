'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { ensureOfferDraft } from '@/lib/admin/offer-drafts'
import { draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Create (or reuse) the offer_drafts row for this offer, then redirect to /edit.
// Mirrors startCouponDraft / startBrandDraft; the edit page's own guard sends
// users back here when no draft exists, so this is the single entry to editing.
export async function startOfferDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  // Someone else's draft opens read-only.
  const mine = await tryAcquireForAction('offer', id)
  if (mine) await ensureOfferDraft(id)
  const host = await getHost()
  redirect(ap(draftEditUrl(`/admin/offers/${id}/edit`, back, mine), host))
}
