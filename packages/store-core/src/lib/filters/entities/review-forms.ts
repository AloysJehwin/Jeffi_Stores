import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { REVIEW_FORM_FIELDS } from '../fields/review-forms'
import { col, containsSearch, ist, nullableTs, yesNo } from './shared'

type ReviewFormKey = FieldKeys<typeof REVIEW_FORM_FIELDS>

const PENDING = "EXISTS (SELECT 1 FROM review_form_submissions rfs WHERE rfs.form_id = rf.id AND rfs.status = 'pending')"

const SQL: Record<ReviewFormKey, FieldSql> = {
  active: { kind: 'bool', expr: 'COALESCE(rf.is_active, false)' },
  template: { kind: 'values', expr: 'rf.template_type' },
  has_coupon: { kind: 'bool', expr: 'rf.coupon_id IS NOT NULL' },
  pending: { kind: 'flag', expr: PENDING },
  submissions: { kind: 'range', expr: 'COALESCE(rf.submissions_count, 0)' },
  created: { kind: 'date', expr: 'rf.created_at' },
}

export const REVIEW_FORMS_ENTITY: FilterEntity<ReviewFormKey> = {
  key: 'review_forms',
  scope: 'review_forms:read',
  noun: 'Forms',
  root: 'review_forms',
  alias: 'rf',
  base: ['rf.is_draft = false'],
  fields: REVIEW_FORM_FIELDS,
  sql: SQL,
  period: 'created',
  search: { build: (q, idx) => containsSearch(['rf.title', 'rf.slug'], q, idx) },
  facets: true,
  export: {
    columns: [
      col('title', 'Title', 'rf.title'),
      col('slug', 'Slug', 'rf.slug'),
      col('template', 'Template', 'rf.template_type'),
      col('status', 'Status', "CASE WHEN rf.is_active THEN 'Active' ELSE 'Inactive' END"),
      col('coupon', 'Reward coupon', '(SELECT c.code FROM coupons c WHERE c.id = rf.coupon_id)'),
      col('submissions', 'Submissions', 'COALESCE(rf.submissions_count, 0)'),
      col(
        'pending',
        'Awaiting review',
        "(SELECT COUNT(*) FROM review_form_submissions s WHERE s.form_id = rf.id AND s.status = 'pending')"
      ),
      col('google_url', 'Google review link', 'rf.google_review_url'),
      col('has_pending', 'Has pending', yesNo(PENDING)),
      col('created', 'Created', ist('rf.created_at')),
    ],
    keyset: [nullableTs('rf.created_at'), 'rf.id'],
  },
}
