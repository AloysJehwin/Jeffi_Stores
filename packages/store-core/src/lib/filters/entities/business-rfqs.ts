import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { RFQ_FIELDS } from '../fields/business-rfqs'

// Business RFQs (business_rfqs r); the buyer's profile and contact are correlated by user_id.

type RfqKey = FieldKeys<typeof RFQ_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`
const PROFILE = { from: 'business_profiles bp', link: 'bp.user_id = r.user_id' }
const USER = (col: string) => `(SELECT u.${col} FROM users u WHERE u.id = r.user_id)`
export const RFQ_ITEMS_SQL = '(SELECT COUNT(*) FROM business_rfq_items i WHERE i.rfq_id = r.id)'

const SQL: Record<RfqKey, FieldSql> = {
  status: { kind: 'enum', expr: 'r.status' },
  created: { kind: 'date', expr: 'r.created_at' },
  items: { kind: 'range', expr: RFQ_ITEMS_SQL },
  reviewed: { kind: 'bool', expr: 'r.reviewed_at IS NOT NULL' },
  converted: { kind: 'bool', expr: 'r.converted_quotation_id IS NOT NULL' },
  company: { kind: 'values', lateral: { ...PROFILE, expr: 'bp.company_name' } },
  industry: { kind: 'values', lateral: { ...PROFILE, expr: 'bp.industry' } },
}

export const RFQ_ENTITY: FilterEntity<RfqKey> = {
  key: 'business_rfqs',
  scope: 'business_rfqs:read',
  noun: 'RFQs',
  root: 'business_rfqs',
  alias: 'r',
  fields: RFQ_FIELDS,
  sql: SQL,
  period: 'created',
  // RFQ number, company or the buyer's email; escaped contains.
  search: {
    build: (q, idx) => ({
      clause: `(r.rfq_number ILIKE $${idx}
        OR EXISTS (SELECT 1 FROM business_profiles bp WHERE bp.user_id = r.user_id AND bp.company_name ILIKE $${idx})
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id AND u.email ILIKE $${idx}))`,
      params: [`%${escapeLike(q.trim())}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'rfq_number', label: 'RFQ no', sql: 'r.rfq_number' },
      { key: 'created_at', label: 'Submitted on', sql: IST('r.created_at') },
      { key: 'status', label: 'Status', sql: 'r.status' },
      { key: 'company', label: 'Company', sql: '(SELECT bp.company_name FROM business_profiles bp WHERE bp.user_id = r.user_id)' },
      { key: 'industry', label: 'Industry', sql: '(SELECT bp.industry FROM business_profiles bp WHERE bp.user_id = r.user_id)' },
      { key: 'contact', label: 'Contact', sql: `btrim(concat_ws(' ', ${USER('first_name')}, ${USER('last_name')}))` },
      { key: 'items', label: 'Line items', sql: RFQ_ITEMS_SQL },
      { key: 'reviewed_at', label: 'Reviewed on', sql: IST('r.reviewed_at') },
      {
        key: 'quotation',
        label: 'Quotation',
        sql: '(SELECT q.quote_number FROM quotations q WHERE q.id = r.converted_quotation_id)',
      },
    ],
    keyset: ['r.created_at', 'r.id'],
  },
}
