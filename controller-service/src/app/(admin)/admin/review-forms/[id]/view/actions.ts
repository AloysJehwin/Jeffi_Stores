'use server'

import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { query } from '@/lib/shared/db'

// Create (or reuse) an edit-draft for the live form, then redirect to /edit.
// Single entry to editing; /edit redirects back to /view when no draft exists.
export async function startReviewFormDraft(id: string, formData: FormData) {
  const back = (formData.get('_back') as string | null) || null
  await query(
    `INSERT INTO review_form_drafts (form_id, fields)
     SELECT rf.id, to_jsonb(rf) - 'id' - 'created_at' - 'updated_at' - 'submissions_count'
     FROM review_forms rf WHERE rf.id = $1
     ON CONFLICT (form_id) DO NOTHING`,
    [id]
  )
  const host = await getHost()
  const qs = back ? `?back=${encodeURIComponent(back)}` : ''
  redirect(ap(`/admin/review-forms/${id}/edit${qs}`, host))
}
