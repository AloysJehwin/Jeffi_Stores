import { describe, it, expect } from 'vitest'
import { INVOICES_ENTITY, INVOICE_SORTS } from '../src/entities/invoices'
import { QUOTATIONS_ENTITY } from '../src/entities/quotations'
import { PURCHASE_ORDERS_ENTITY } from '../src/entities/purchase-orders'
import { normalizeQuery, buildWhere, countQuery } from '../src/clauses'
import { exportQuery } from '../src/export'
import { valuesQuery } from '../src/values'
import { sortClause } from '../src/sort'

describe('INVOICES_ENTITY (union)', () => {
  it('normalizeQuery applies the payment alias and date aliases', () => {
    const q = normalizeQuery(INVOICES_ENTITY, { payment: 'paid', date_from: '2026-01-01', date_to: '2026-02-01', source: 'online,amazon' })
    expect(q.payment_status).toBe('paid')
    expect(q.from).toBe('2026-01-01')
    expect(q.to).toBe('2026-02-01')
    expect(q.source).toBe('online|amazon')
  })

  it('buildWhere on the order branch uses the branch base + order SQL', () => {
    const w = buildWhere(INVOICES_ENTITY, { source: 'online', overdue: 'true' }, 1, { branch: 'order' })
    expect(w.where).toContain('o.invoice_number IS NOT NULL')
    expect(w.where).toContain("o.source != 'cash_sale'")
    expect(w.where).toContain('o.source IN ($1)')
    expect(w.where).toContain('payment_status') // overdue flag SQL
  })

  it('buildWhere on the cash_sale branch', () => {
    const w = buildWhere(INVOICES_ENTITY, { voided: 'true' }, 1, { branch: 'cash_sale' })
    expect(w.where).toContain('cs.invoice_number IS NOT NULL')
    expect(w.where).toContain("(cs.status = 'cancelled')")
  })

  it('countQuery unions both branches', () => {
    const { sql } = countQuery(INVOICES_ENTITY, {}, 100)
    expect(sql).toContain('FROM orders o')
    expect(sql).toContain('FROM cash_sales cs')
    expect(sql).toContain('UNION ALL')
  })

  it('exportQuery: order branch keeps columns, cash branch NULLs email/gstin etc', () => {
    const r = exportQuery(INVOICES_ENTITY, {})
    expect(r).not.toBeNull()
    expect(r!.sql).toContain('o.invoice_number AS "invoice_number"')
    // email exists only on the order branch; cash sale lacks it → NULL
    expect(r!.sql).toContain('NULL AS "email"')
  })

  it('valuesQuery for irn_status over the union', () => {
    const r = valuesQuery(INVOICES_ENTITY, 'irn_status', {})
    expect(r).not.toBeNull()
    expect(r!.sql).toContain('UNION ALL')
  })

  it('sortClause maps a whitelisted key', () => {
    expect(sortClause(new URLSearchParams('sort=total_amount&dir=asc'), {
      sorts: INVOICE_SORTS, defaultSql: 'invoice_date DESC', tiebreak: 'id',
    })).toBe('ORDER BY total_amount ASC NULLS LAST, id')
  })
})

describe('QUOTATIONS_ENTITY', () => {
  it('pipeline virtual options expand to their own SQL (open/expiring/lapsed/stale_draft)', () => {
    const w = buildWhere(QUOTATIONS_ENTITY, { pipeline: 'open|expiring|lapsed|stale_draft' }, 1)
    expect(w.where).toContain("q.status = 'final'")
    expect(w.where).toContain('BETWEEN')
    expect(w.where).toContain("q.status = 'draft'")
    expect(w.where).toContain('INTERVAL')
  })

  it('dateOnly quote_date filter casts to date', () => {
    const w = buildWhere(QUOTATIONS_ENTITY, { from: '2026-01-01' }, 1)
    expect(w.where).toContain('q.quote_date >= $1::date')
  })

  it('amount range uses the stored-or-computed total SQL', () => {
    const w = buildWhere(QUOTATIONS_ENTITY, { amount_min: '100' }, 1)
    expect(w.where).toContain('CASE WHEN COALESCE(q.total_amount, 0) = 0')
  })

  it('created_by value-help uses the lateral admin-name source', () => {
    const r = valuesQuery({ ...QUOTATIONS_ENTITY, facets: true }, 'created_by', {})
    expect(r!.sql).toContain('admins a JOIN users u')
  })

  it('q alias → search; search builds a vector clause', () => {
    const q = normalizeQuery(QUOTATIONS_ENTITY, { q: 'acme' })
    expect(q.search).toBe('acme')
    const w = buildWhere(QUOTATIONS_ENTITY, q, 1)
    expect(w.where).toContain('q.search_vector @@ to_tsquery')
  })

  it('exportQuery includes computed subtotal/total and converted-order subselect', () => {
    const r = exportQuery(QUOTATIONS_ENTITY, {})
    expect(r!.sql).toContain('q.quote_number AS "quote_number"')
    expect(r!.sql).toContain('converted_order')
  })
})

describe('PURCHASE_ORDERS_ENTITY', () => {
  it('custom supplier_id: valid uuid → binds ::uuid clause', () => {
    const uuid = '11111111-2222-3333-4444-555555555555'
    const w = buildWhere(PURCHASE_ORDERS_ENTITY, { supplier_id: uuid }, 1)
    expect(w.where).toContain('po.supplier_id = $1::uuid')
    expect(w.params).toContain(uuid)
  })

  it('custom supplier_id: non-uuid → no clause', () => {
    const w = buildWhere(PURCHASE_ORDERS_ENTITY, { supplier_id: 'not-a-uuid' }, 1)
    expect(w.where).not.toContain('po.supplier_id')
  })

  it('status enum + date range + overdue flag', () => {
    const w = buildWhere(PURCHASE_ORDERS_ENTITY, { status: 'sent', from: '2026-01-01', overdue: 'true' }, 1)
    expect(w.where).toContain('po.status IN ($1)')
    expect(w.where).toContain('po.order_date >= $2::date')
    expect(w.where).toContain("po.status IN ('sent', 'partial')")
  })

  it('supplier value-help uses the supplier-name subquery', () => {
    const r = valuesQuery({ ...PURCHASE_ORDERS_ENTITY, facets: true }, 'supplier', {})
    expect(r!.sql).toContain('SELECT s.name FROM suppliers s')
  })

  it('search uses buildSearchClause over po_number + supplier name', () => {
    const w = buildWhere(PURCHASE_ORDERS_ENTITY, { search: 'po-1' }, 1)
    expect(w.where).toContain('po.po_number ILIKE')
    expect(w.where).toContain('word_similarity')
  })

  it('default sort uses defaultSql + tiebreak', () => {
    expect(sortClause(new URLSearchParams(''), {
      sorts: PURCHASE_ORDERS_ENTITY.sorts!, defaultSql: PURCHASE_ORDERS_ENTITY.defaultSql!, tiebreak: PURCHASE_ORDERS_ENTITY.tiebreak,
    })).toBe('ORDER BY po.created_at DESC, po.id DESC')
  })

  it('exportQuery builds PO columns', () => {
    const r = exportQuery(PURCHASE_ORDERS_ENTITY, {})
    expect(r!.sql).toContain('po.po_number AS "po_number"')
    expect(r!.sql).toContain('grns g')
  })
})
