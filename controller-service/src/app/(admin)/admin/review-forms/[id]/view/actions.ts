'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'
import { draftEditUrl, tryAcquireForAction } from '@/lib/admin/draft-locks'

// Create (or reuse) an edit-draft for the live form, then redirect to /edit.
// Single entry to editing; /edit redirects back to /view when no draft exists.
export async function startReviewFormDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  // Someone else's draft opens read-only.
  const mine = await tryAcquireForAction('review_form', id)
  if (mine)
    await query(
      `INSERT INTO review_form_drafts (form_id, fields)
       SELECT rf.id, to_jsonb(rf) - 'id' - 'created_at' - 'updated_at' - 'submissions_count'
       FROM review_forms rf WHERE rf.id = $1
       ON CONFLICT (form_id) DO NOTHING`,
      [id]
    )
  const host = await getHost()
  redirect(ap(draftEditUrl(`/admin/review-forms/${id}/edit`, back, mine), host))
}
