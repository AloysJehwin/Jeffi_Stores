import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { buildProductSearchClause, buildProductSearchRank, buildVectorSearchClause, buildSearchClause } from '@/lib/search'

export const dynamic = 'force-dynamic'

type SuggestItem = {
  id: string
  label: string
  sublabel?: string
  href?: string
}

async function suggestProducts(q: string): Promise<SuggestItem[]> {
  const sc = buildProductSearchClause(q, 'p.name', 'p.sku', 'p.search_vector', 1)
  const rk = buildProductSearchRank(q, 'p.name', 'p.search_vector', sc.nextIdx)
  const rows = await queryMany<{ id: string; name: string; sku: string }>(
    `SELECT p.id, p.name, p.sku FROM products p
     WHERE p.is_active = true AND ${sc.clause}
     ORDER BY ${rk.rank}, p.name ASC LIMIT 6`,
    [...sc.params, ...rk.params]
  )
  return (rows || []).map(r => ({ id: r.id, label: r.name, sublabel: r.sku, href: `/admin/products?search=${encodeURIComponent(q)}` }))
}

async function suggestOrders(q: string): Promise<SuggestItem[]> {
  const sc = buildVectorSearchClause(q, 'o.search_vector', ['o.customer_name'], ['o.order_number'], 1, 'simple')
  const rows = await queryMany<{ id: string; order_number: string; customer_name: string }>(
    `SELECT o.id, o.order_number, o.customer_name FROM orders o
     WHERE ${sc.clause} ORDER BY o.created_at DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.order_number, sublabel: r.customer_name, href: `/admin/orders?search=${encodeURIComponent(q)}` }))
}

async function suggestCustomers(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['name', 'email', 'phone'], 1)
  const rows = await queryMany<{ id: string; name: string; email: string; phone: string }>(
    `SELECT u.id, u.name, u.email, u.phone FROM users u
     JOIN customer_profiles cp ON cp.user_id = u.id
     WHERE ${sc.clause} ORDER BY u.name ASC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.name, sublabel: r.phone || r.email, href: `/admin/customers?search=${encodeURIComponent(q)}` }))
}

async function suggestInvoices(q: string): Promise<SuggestItem[]> {
  const sc = buildVectorSearchClause(q, 'o.search_vector', ['o.customer_name'], ['o.invoice_number', 'o.order_number'], 1, 'simple')
  const rows = await queryMany<{ id: string; invoice_number: string | null; order_number: string; customer_name: string }>(
    `SELECT o.id, o.invoice_number, o.order_number, o.customer_name FROM orders o
     WHERE o.invoice_number IS NOT NULL AND ${sc.clause}
     ORDER BY o.created_at DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.invoice_number || r.order_number, sublabel: r.customer_name }))
}

async function suggestQuotations(q: string): Promise<SuggestItem[]> {
  const sc = buildVectorSearchClause(q, 'q.search_vector', ['q.consignee_name'], ['q.quote_number'], 1, 'simple')
  const rows = await queryMany<{ id: string; quote_number: string; consignee_name: string }>(
    `SELECT q.id, q.quote_number, q.consignee_name FROM quotations q
     WHERE ${sc.clause} ORDER BY q.created_at DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.quote_number, sublabel: r.consignee_name }))
}

async function suggestCategories(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['name'], 1)
  const rows = await queryMany<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM categories WHERE ${sc.clause} ORDER BY name ASC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.name, sublabel: r.slug }))
}

async function suggestCoupons(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['code', 'description'], 1)
  const rows = await queryMany<{ id: string; code: string; discount_type: string; discount_value: string }>(
    `SELECT id, code, discount_type, discount_value FROM coupons WHERE ${sc.clause} ORDER BY code ASC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.code, sublabel: `${r.discount_type === 'percentage' ? r.discount_value + '%' : '₹' + r.discount_value} off` }))
}

async function suggestBrands(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['name'], 1)
  const rows = await queryMany<{ id: string; name: string }>(
    `SELECT id, name FROM brands WHERE is_active = true AND ${sc.clause} ORDER BY name ASC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.name }))
}

async function suggestSuppliers(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['name', 'gstin', 'contact_name'], 1)
  const rows = await queryMany<{ id: string; name: string; phone: string }>(
    `SELECT id, name, phone FROM suppliers WHERE is_active = true AND ${sc.clause} ORDER BY name ASC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.name, sublabel: r.phone }))
}

async function suggestFinancialReceivables(q: string): Promise<SuggestItem[]> {
  const sc = buildVectorSearchClause(q, 'o.search_vector', ['o.customer_name'], ['o.invoice_number', 'o.order_number'], 1, 'simple')
  const rows = await queryMany<{ id: string; order_number: string; customer_name: string; total_amount: string }>(
    `SELECT o.id, o.order_number, o.customer_name, o.total_amount FROM orders o
     WHERE o.payment_status IN ('unpaid','partial') AND ${sc.clause}
     ORDER BY o.created_at DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.customer_name, sublabel: `${r.order_number} · ₹${Number(r.total_amount).toLocaleString('en-IN')}` }))
}

async function suggestPurchaseOrders(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['po.po_number', 's.name'], 1)
  const rows = await queryMany<{ id: string; po_number: string; supplier_name: string; total_amount: string }>(
    `SELECT po.id, po.po_number, s.name AS supplier_name, po.total_amount
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.status != 'cancelled' AND ${sc.clause}
     ORDER BY po.order_date DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.po_number, sublabel: `${r.supplier_name} · ₹${Number(r.total_amount).toLocaleString('en-IN')}` }))
}

async function suggestPayables(q: string): Promise<SuggestItem[]> {
  const sc = buildSearchClause(q, ['e.supplier_name', 'e.expense_number'], 1)
  const rows = await queryMany<{ id: string; supplier_name: string; expense_number: string; total_amount: string }>(
    `SELECT e.id, e.supplier_name, e.expense_number, e.total_amount FROM expenses e
     WHERE e.status != 'paid' AND ${sc.clause} ORDER BY e.expense_date DESC LIMIT 6`,
    sc.params
  )
  return (rows || []).map(r => ({ id: r.id, label: r.supplier_name, sublabel: `${r.expense_number} · ₹${Number(r.total_amount).toLocaleString('en-IN')}` }))
}

const handlers: Record<string, (q: string) => Promise<SuggestItem[]>> = {
  products: suggestProducts,
  orders: suggestOrders,
  customers: suggestCustomers,
  invoices: suggestInvoices,
  quotations: suggestQuotations,
  categories: suggestCategories,
  coupons: suggestCoupons,
  brands: suggestBrands,
  suppliers: suggestSuppliers,
  purchase_orders: suggestPurchaseOrders,
  receivables: suggestFinancialReceivables,
  payables: suggestPayables,
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || ''
    const type = request.nextUrl.searchParams.get('type') || ''

    if (q.length < 2 || !handlers[type]) {
      return NextResponse.json({ items: [] })
    }

    const items = await handlers[type](q)
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [] }, { status: 500 })
  }
}
