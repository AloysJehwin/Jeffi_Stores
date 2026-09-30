'use server'

import { query } from '@/lib/shared/db'

export async function discardReviewFormDraft(formId: string) {
  await query(`DELETE FROM review_form_drafts WHERE form_id = $1`, [formId])
}
