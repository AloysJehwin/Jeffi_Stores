import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
  runWithTenantContext: vi.fn((_t: unknown, fn: () => unknown) => fn()),
}))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/export/presets', () => ({ listPresets: vi.fn(async () => ({ presets: [], last: null })), savePreset: vi.fn(async () => null) }))
vi.mock('@/lib/export/branding', () => ({
  loadBrand: vi.fn(async () => ({ name: 'Store', legalName: '', gstin: '22AAAAA0000A1Z5', address: '', phone: '', email: '', logo: null })),
  adminDisplayName: vi.fn(async () => 'Admin'),
}))

import { queryMany, queryOne } from '@/lib/shared/db'
import { bySource, computeGstr3b, filterBySource, getGstr1, getGstr3b, parseSources, summarizeGstr1, type GstInvoice } from '@/lib/gst/returns'
import { GSTR1_EXPORT, GSTR3B_EXPORT } from '@/lib/export/definitions/gst'
import { runExport } from '@/lib/export/pipeline'
import { DEFAULT_BRANDING } from '@/lib/export/types'

const mockMany = vi.mocked(queryMany)
const mockOne = vi.mocked(queryOne)
const admin = { adminId: 'a1', role: 'administrator', scopes: [] } as any

const item = (taxable: number, rate = 18, hsn = '6109') => ({
  product_name: 'Tee',
  hsn_code: hsn,
  uqc: 'NOS',
  gst_rate: rate,
  quantity: 1,
  taxable_amount: taxable,
  cgst_amount: (taxable * rate) / 200,
  sgst_amount: (taxable * rate) / 200,
  igst_amount: 0,
  total_price: taxable * (1 + rate / 100),
})

const inv = (no: string, source: string, taxable: number, gstin: string | null = null): GstInvoice => ({
  kind: source === 'cash_sale' ? 'cash_sale' : 'order',
  source,
  invoice_number: no,
  invoice_date: '2026-11-05',
  order_number: no,
  customer_name: 'Buyer',
  buyer_gstin: gstin,
  is_igst: false,
  taxable_amount: taxable,
  cgst_amount: taxable * 0.09,
  sgst_amount: taxable * 0.09,
  igst_amount: 0,
  total_amount: taxable * 1.18,
  buyer_state: 'Chhattisgarh',
  irn: null,
  irn_ack_no: null,
  irn_ack_dt: null,
  items: [item(taxable)],
})

const INVOICES = [
  inv('JS/1', 'online', 1000, '22BBBBB1111B1Z5'),
  inv('JS/2', 'online', 500),
  inv('JS/3', 'offline', 200),
  inv('JS/4', 'cash_sale', 300),
]

/** queryMany by SQL: the invoiced-sources list, else the invoices. */
function serveInvoices(rows = INVOICES) {
  mockMany.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT DISTINCT o.source')) return [{ source: 'online' }, { source: 'offline' }, { source: 'cash_sale' }] as any
    return rows as any
  })
}

beforeEach(() => {
  mockMany.mockReset()
  mockOne.mockReset()
})

describe('GSTR-1 by revenue source', () => {
  it('summarises every source when none is excluded', async () => {
    serveInvoices()
    const r = await getGstr1('2026-11-01', '2026-11-30')
    expect(r.summary.totalInvoices).toBe(4)
    expect(r.summary.totalTaxable).toBe(2000)
    expect(r.summary.totalTax).toBe(360)
    expect(r.summary.b2bCount).toBe(1)
    expect(r.bySource.map(s => s.source).sort()).toEqual(['cash_sale', 'offline', 'online'])
  })

  it('recomputes every total without the excluded source, keeping the full source list', async () => {
    serveInvoices()
    const r = await getGstr1('2026-11-01', '2026-11-30', ['online', 'offline'])
    expect(r.summary.totalInvoices).toBe(3)
    expect(r.summary.totalTaxable).toBe(1700)
    expect(r.summary.totalCgst).toBe(153)
    expect(r.summary.totalInvoiceValue).toBe(2006)
    expect(r.hsnSummary).toEqual([expect.objectContaining({ hsnCode: '6109', taxableVal: 1700, totalTax: 306 })])
    expect(r.b2c.map(x => x.invoice_number)).toEqual(['JS/2', 'JS/3'])
    expect(r.bySource).toHaveLength(3)
  })

  it('treats a missing source as online and parses the query param', () => {
    expect(filterBySource([{ source: undefined }], ['online'])).toHaveLength(1)
    expect(parseSources(null)).toBeNull()
    expect(parseSources('online|cash_sale,DROP TABLE')).toEqual(['online', 'cash_sale'])
    expect(bySource(INVOICES)[0]).toMatchObject({ source: 'online', invoices: 2, taxable: 1500 })
    expect(summarizeGstr1([]).totalTax).toBe(0)
  })
})

describe('GSTR-1 export matches the page', () => {
  const run = async (sources: string[]) => {
    serveInvoices()
    const out = await runExport(GSTR1_EXPORT, admin, {
      options: { format: 'csv', scope: 'filtered', columns: ['invoice_number', 'invoice_date', 'buyer_gstin', 'customer_name', 'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'total_tax', 'total_amount'], filters: { sources, sections: ['b2b', 'b2c', 'hsn', 'sources'] }, range: { from: '2026-11-01', to: '2026-11-30' }, branding: { ...DEFAULT_BRANDING } },
    })
    return Buffer.from(await new Response(out.body).arrayBuffer()).toString('utf8')
  }

  it('leaves cash sales out of every table and total when unticked', async () => {
    const page = (serveInvoices(), await getGstr1('2026-11-01', '2026-11-30', ['online', 'offline']))
    const csv = await run(['online', 'offline'])
    expect(csv).toContain('Filters,"Revenue sources: Online store, Offline / counter"')
    expect(csv).not.toContain('JS/4')
    // B2C table totals (JS/2 + JS/3) and the summary equal the page's figures for the same sources.
    expect(csv).toContain('Total,,,,700.00,63.00,63.00,0.00,126.00,826.00')
    expect(csv).toContain(`Taxable value,${page.summary.totalTaxable.toFixed(2)}`)
    expect(csv).toContain(`Total tax,${page.summary.totalTax.toFixed(2)}`)
    expect(csv).toContain(`Invoice value,${page.summary.totalInvoiceValue.toFixed(2)}`)
  })

  it('includes cash sales when every source is ticked', async () => {
    const csv = await run(['online', 'offline', 'cash_sale'])
    expect(csv).toContain('JS/4')
    expect(csv).toContain('Taxable value,2000.00')
    expect(csv).not.toContain('Filters,Revenue sources')
  })
})

describe('GSTR-3B', () => {
  it('builds the tables from outward totals and rate lines', () => {
    const r = computeGstr3b(
      { total_taxable: '1500', total_cgst: '90', total_sgst: '90', total_igst: '90', invoice_count: 3 },
      [
        { gst_rate: '18', is_igst: false, b2c: true, taxable: '1000', cgst: '90', sgst: '90', igst: '0' },
        { gst_rate: '18', is_igst: true, b2c: true, taxable: '300', igst: '54' },
        { gst_rate: '18', is_igst: true, b2c: false, taxable: '200', igst: '36' },
      ],
      { business_gstin: '22AAAAA0000A1Z5', business_legal_name: 'Test' },
      { from: '2026-11-01', to: '2026-11-30' }
    )
    expect(r.summary.totalTax).toBe(270)
    expect(r.table32.supplies).toEqual([{ gstRate: 18, taxableValue: 300, igst: 54 }])
    expect(r.summary.byGstRate).toEqual([
      { gstRate: 18, isIgst: false, taxable: 1000, cgst: 90, sgst: 90, igst: 0 },
      { gstRate: 18, isIgst: true, taxable: 500, cgst: 0, sgst: 0, igst: 90 },
    ])
    expect(r.table6.igst.cashPaid).toBe(90)
  })

  it('pushes the source filter into its queries and the export carries the same totals', async () => {
    mockOne.mockResolvedValue({ total_taxable: '1700', total_cgst: '153', total_sgst: '153', total_igst: '0', invoice_count: 3 })
    mockMany.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT o.source')) return [{ source: 'online' }, { source: 'offline' }, { source: 'cash_sale' }] as any
      if (sql.includes('site_settings')) return [{ key: 'business_gstin', value: '22AAAAA0000A1Z5' }] as any
      return [{ gst_rate: 18, is_igst: false, b2c: true, taxable: '1700', cgst: '153', sgst: '153', igst: '0' }] as any
    })
    const page = await getGstr3b('2026-11-01', '2026-11-30', ['online', 'offline'])
    expect(mockOne.mock.calls[0][0]).toContain('inv.source = ANY($3::text[])')
    expect(mockOne.mock.calls[0][1]).toEqual(['2026-11-01', '2026-11-30', ['online', 'offline']])
    expect(page.summary.totalTax).toBe(306)
    const out = await runExport(GSTR3B_EXPORT, admin, {
      options: { format: 'csv', scope: 'filtered', columns: ['gstRate', 'supply', 'taxable', 'igst', 'cgst', 'sgst', 'totalTax'], filters: { sources: ['online', 'offline'] }, range: { from: '2026-11-01', to: '2026-11-30' }, branding: { ...DEFAULT_BRANDING } },
    })
    const csv = Buffer.from(await new Response(out.body).arrayBuffer()).toString('utf8')
    expect(csv).toContain('Total tax payable,306.00')
    expect(csv).toContain('1700.00,0.00,153.00,153.00,0.00')
  })
})
