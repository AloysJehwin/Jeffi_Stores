import { queryCount, queryMany, queryOne } from '@/lib/shared/db'

// A review form's submissions, newest first: the admin list (a page at a time) and its export.

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const

export interface FormSubmission {
  id: string
  email: string
  screenshot_url: string | null
  coupon_code: string | null
  status: string
  submitted_at: string | Date
  extra_fields: Record<string, string> | null
}

export async function listFormSubmissions(
  formId: string,
  opts: { status?: string | null; limit: number; offset: number }
): Promise<{ submissions: FormSubmission[]; total: number }> {
  const conditions = ['rfs.form_id = $1']
  const params: unknown[] = [formId]
  let i = 2
  if (opts.status && (SUBMISSION_STATUSES as readonly string[]).includes(opts.status)) {
    conditions.push(`rfs.status = $${i++}`)
    params.push(opts.status)
  }
  const where = `WHERE ${conditions.join(' AND ')}`
  const [submissions, total] = await Promise.all([
    queryMany<FormSubmission>(`SELECT rfs.* FROM review_form_submissions rfs ${where} ORDER BY rfs.submitted_at DESC LIMIT $${i} OFFSET $${i + 1}`, [
      ...params,
      opts.limit,
      opts.offset,
    ]),
    queryCount(`SELECT COUNT(*) FROM review_form_submissions rfs ${where}`, params),
  ])
  return { submissions, total }
}

export async function reviewFormMeta(formId: string): Promise<{ title: string; custom_fields: { id: string; label: string; type: string }[] } | null> {
  return queryOne(`SELECT title, COALESCE(custom_fields, '[]'::jsonb) AS custom_fields FROM review_forms WHERE id = $1`, [formId])
}
