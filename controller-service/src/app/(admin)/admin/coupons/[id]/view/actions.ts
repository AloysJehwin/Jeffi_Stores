'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'
import { draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Create (or reuse) an edit-draft for the coupon, then redirect to the edit page.
// This is the single entry to editing; the edit page itself redirects back here
// when no draft exists.
export async function startCouponDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  // Someone else's draft opens read-only.
  const mine = await tryAcquireForAction('coupon', id)
  if (mine)
    await query(
      `INSERT INTO coupon_drafts (coupon_id, fields)
       SELECT c.id, to_jsonb(c) - 'id' - 'created_at' - 'updated_at'
       FROM coupons c WHERE c.id = $1
       ON CONFLICT (coupon_id) DO NOTHING`,
      [id]
    )
  const host = await getHost()
  redirect(ap(draftEditUrl(`/admin/coupons/${id}/edit`, back, mine), host))
}
