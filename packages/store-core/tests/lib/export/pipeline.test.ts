import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/tenancy/tenant-context', () => ({
  resolveTenant: vi.fn(async () => null),
  runWithTenantContext: vi.fn((_t: unknown, fn: () => unknown) => fn()),
}))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/export/presets', () => ({
  listPresets: vi.fn(async () => ({ presets: [], last: null })),
  savePreset: vi.fn(async () => null),
}))
vi.mock('@/lib/export/branding', () => ({
  loadBrand: vi.fn(async () => ({ name: 'Test Store', legalName: 'Test Traders', gstin: '22AAAAA0000A1Z5', address: 'Station Road, Raipur', phone: '', email: '', logo: null })),
  adminDisplayName: vi.fn(async () => 'Asha Admin'),
}))

import { batches, defineExport } from '@/lib/export/define'
import { ExportError, countExport, exportSchema, runExport } from '@/lib/export/pipeline'
import { DEFAULT_BRANDING, defaultColumns, describeFilterValues, narrowed, sanitizeOptions, type ExportOptions } from '@/lib/export/types'
import { Totals, csvText, displayText, toDate } from '@/lib/export/format'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { savePreset } from '@/lib/export/presets'

const admin = { adminId: 'a1', role: 'administrator', scopes: [] } as any

const ROWS = [
  { id: 'r1', no: 'INV-1', date: '2026-11-01', channel: 'online', amount: '100.50' },
  { id: 'r2', no: 'INV-2', date: '2026-11-02', channel: 'cash', amount: 200 },
  { id: 'r3', no: 'INV-3', date: '2026-11-03', channel: 'online', amount: '=1+1' },
]

const CHANNELS = { key: 'channel', label: 'Channels', kind: 'multi' as const, options: [{ value: 'online', label: 'Online' }, { value: 'cash', label: 'Cash sale' }] }

const def = defineExport({
  key: 'test.sales',
  title: 'Sales',
  noun: 'Sales',
  scope: 'orders:read',
  columns: [
    { key: 'channel', label: 'Channel' },
    { key: 'no', label: 'Invoice No', id: true },
    { key: 'date', label: 'Date', type: 'date', id: true },
    { key: 'amount', label: 'Amount', type: 'money', total: 'sum' },
    { key: 'id', label: 'Id', optional: true },
  ],
  filters: [CHANNELS],
  scopes: ['filtered', 'selected', 'all'],
  dateRange: true,
  count: async ctx => ROWS.filter(r => !narrowed(CHANNELS, ctx.filters) || narrowed(CHANNELS, ctx.filters)!.includes(r.channel)).length,
  sections: async ctx => {
    const picked = narrowed(CHANNELS, ctx.filters)
    const rows = ROWS.filter(r => (!picked || picked.includes(r.channel)) && (!ctx.ids || ctx.ids.includes(r.id)))
    return [{ key: 'sales', rows: batches(rows, 2) }]
  },
})

const opts = (patch: Partial<ExportOptions> = {}): ExportOptions => ({
  format: 'csv',
  scope: 'filtered',
  columns: ['no', 'date', 'channel', 'amount'],
  filters: { channel: ['online', 'cash'] },
  branding: { ...DEFAULT_BRANDING },
  ...patch,
})

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer())
}

beforeEach(() => vi.clearAllMocks())

describe('export contract', () => {
  it('orders identifying columns first and leaves optional ones out', () => {
    expect(defaultColumns(def.columns)).toEqual(['no', 'date', 'channel', 'amount'])
  })

  it('sanitizes a request against the schema', () => {
    const s = { columns: def.columns, filters: [CHANNELS], scopes: def.scopes!, formats: ['csv', 'xlsx'] as const, dateRange: { label: 'Range' } }
    const o = sanitizeOptions({ ...s, formats: [...s.formats] }, {
      format: 'pptx' as any,
      scope: 'page' as any,
      columns: ['amount', 'nope', 'no', 'amount'],
      filters: { channel: ['cash', 'evil'], other: true } as any,
      range: { from: '2026-11-01', to: 'bad' },
      branding: { logo: false } as any,
    })
    expect(o.format).toBe('xlsx')
    expect(o.scope).toBe('filtered')
    expect(o.columns).toEqual(['amount', 'no'])
    expect(o.filters).toEqual({ channel: ['cash'] })
    expect(o.range).toEqual({ from: '2026-11-01' })
    expect(o.branding.logo).toBe(false)
    expect(o.branding.header).toBe(true)
  })

  it('describes only narrowed filters', () => {
    expect(describeFilterValues([CHANNELS], { channel: ['online', 'cash'] })).toEqual([])
    expect(describeFilterValues([CHANNELS], { channel: ['online'] })).toEqual(['Channels: Online'])
    expect(narrowed(CHANNELS, { channel: ['online', 'cash'] })).toBeNull()
  })
})

describe('cell formatting', () => {
  it('reads zone-less wall-clock text as IST', () => {
    expect(toDate('2026-11-27 10:30')!.toISOString()).toBe('2026-11-27T05:00:00.000Z')
    expect(csvText('2026-11-27 10:30', 'datetime')).toBe('2026-11-27 10:30')
  })

  it('formats money for files and for display', () => {
    expect(csvText('1234.5', 'money')).toBe('1234.50')
    expect(displayText(1234567.5, 'money')).toBe('₹12,34,567.50')
    expect(csvText(true, 'bool')).toBe('Yes')
  })

  it('totals only declared columns', () => {
    const t = new Totals([{ key: 'a', label: 'A', total: 'sum' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C', total: 'count' }])
    t.add({ a: '1.105', b: 5, c: 'x' })
    t.add({ a: 2, b: 5, c: '' })
    expect(t.result()).toEqual({ a: 3.11, c: 1 })
  })
})

describe('runExport', () => {
  it('streams CSV with a header block, neutralised cells and a totals row', async () => {
    const out = await runExport(def, admin, { options: opts() })
    expect(out.contentType).toContain('text/csv')
    expect(out.filename).toMatch(/^test\.sales-\d{4}-\d{2}-\d{2}\.csv$/)
    const text = (await bytes(out.body)).toString('utf8')
    expect(text.startsWith('﻿Store,Test Store (Test Traders)\r\n')).toBe(true)
    expect(text).toContain('GSTIN,22AAAAA0000A1Z5')
    expect(text).toContain('Generated by,Asha Admin')
    expect(text).toContain('Invoice No,Date,Channel,Amount\r\n')
    expect(text).toContain("INV-3,2026-11-03,online,'=1+1")
    expect(text).toContain('Total,,,300.50')
    await vi.waitFor(() => expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', entityType: 'test.sales' })))
    expect(savePreset).toHaveBeenCalledWith('a1', 'test.sales', '', expect.objectContaining({ format: 'csv' }))
  })

  it('recomputes totals when a filter option is unticked', async () => {
    const out = await runExport(def, admin, { options: opts({ filters: { channel: ['cash'] } }) })
    const text = (await bytes(out.body)).toString('utf8')
    expect(text).toContain('Filters,Channels: Cash sale')
    expect(text).not.toContain('INV-1')
    expect(text).toContain('Total,,,200.00')
    expect(await countExport(def, admin, { options: opts({ filters: { channel: ['cash'] } }) })).toBe(1)
  })

  it('honours the branding switches', async () => {
    const out = await runExport(def, admin, { options: opts({ branding: { ...DEFAULT_BRANDING, header: false, summary: false } }) })
    const text = (await bytes(out.body)).toString('utf8')
    expect(text.startsWith('﻿Invoice No,Date')).toBe(true)
    expect(text).not.toContain('Total')
  })

  it('exports only the selected ids, and refuses an empty selection', async () => {
    await expect(runExport(def, admin, { options: opts({ scope: 'selected' }), context: { selectedIds: [] } })).rejects.toBeInstanceOf(ExportError)
    const out = await runExport(def, admin, { options: opts({ scope: 'selected' }), context: { selectedIds: ['r2'] } })
    const text = (await bytes(out.body)).toString('utf8')
    expect(text).toContain('Filters,Scope: Selected rows (1)')
    expect(text).toContain('INV-2')
    expect(text).not.toContain('INV-1')
  })

  it('writes a typed Excel workbook with the header block and totals', async () => {
    const out = await runExport(def, admin, { options: opts({ format: 'xlsx' }) })
    const buf = await bytes(out.body)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const ws = wb.worksheets[0]
    expect(ws.name).toBe('Sales')
    expect(ws.getCell('A1').value).toBe('Store')
    const values = Array.from(ws.getSheetValues(), r => (Array.isArray(r) ? r.slice(1) : []))
    const head = values.findIndex(r => r[0] === 'Invoice No')
    expect(head).toBeGreaterThan(1)
    expect(values[head + 1][3]).toBe(100.5)
    expect(values[head + 4][0]).toBe('Total')
    expect(values[head + 4][3]).toBe(300.5)
  })

  it('renders PDF and PowerPoint documents', async () => {
    const pdf = await bytes((await runExport(def, admin, { options: opts({ format: 'pdf' }) })).body)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    const pptx = await bytes((await runExport(def, admin, { options: opts({ format: 'pptx' }) })).body)
    expect(pptx.subarray(0, 2).toString()).toBe('PK')
  }, 30_000)

  it('pulls streamed rows inside the request tenant', async () => {
    const tc = await import('@/lib/tenancy/tenant-context')
    let current: string | null = null
    vi.mocked(tc.resolveTenant).mockResolvedValueOnce({ tenantId: 't-store' } as any)
    vi.mocked(tc.runWithTenantContext).mockImplementation(async (t: any, fn: () => Promise<any>) => {
      const prev = current
      current = t.tenantId
      try {
        return await fn()
      } finally {
        current = prev
      }
    })
    const seen: (string | null)[] = []
    const tenantDef = defineExport({
      ...def,
      sections: async () => [{ key: 's', rows: (async function* () { seen.push(current); yield [ROWS[0]]; seen.push(current); yield [ROWS[1]] })() }],
    })
    const out = await runExport(tenantDef, admin, { options: opts() })
    await bytes(out.body)
    expect(seen).toEqual(['t-store', 't-store'])
    vi.mocked(tc.runWithTenantContext).mockImplementation(((_t: unknown, fn: () => unknown) => fn()) as any)
  })

  it('exports an insights series the page sends, with its own columns and no DB read', async () => {
    const { INSIGHTS_EXPORT } = await import('@/lib/export/definitions/insights')
    const query = 'title=Returns&series=req:Requested|ok:Approved&from=2026-01-05&to=2026-01-18&today=2026-01-06&filter=Refunds'
    const s = await exportSchema(INSIGHTS_EXPORT, admin, new URLSearchParams(query))
    expect(s.title).toBe('Returns — daily')
    expect(s.columns.map(c => c.label)).toEqual(['Date', 'Requested', 'Approved', 'Total'])
    const days = [
      { date: '2026-01-05', values: [2, 1] },
      { date: '2026-01-06', values: [3, 0] },
      { date: '2026-01-07', values: [0, 0] },
      { date: '<script>', values: [9, 9] },
      { nested: { deep: true } },
    ]
    const out = await runExport(INSIGHTS_EXPORT, admin, { options: { ...opts(), columns: s.defaults.columns }, context: { query, rows: days } })
    const text = (await bytes(out.body)).toString('utf8')
    expect(out.filename).toBe('returns-2026-01-05_2026-01-18.csv')
    expect(text).toContain('Filters,View: Refunds')
    expect(text).toContain('Date,Requested,Approved,Total\r\n2026-01-05,2,1,3\r\n2026-01-06,3,0,3\r\nTotal,5,1,6')
    expect(text).not.toContain('2026-01-07')
    expect(text).not.toContain('script')
  })

  it('builds the dialog schema with defaults', async () => {
    const s = await exportSchema(def, admin, new URLSearchParams())
    expect(s.defaults.columns).toEqual(['no', 'date', 'channel', 'amount'])
    expect(s.defaults.format).toBe('xlsx')
    expect(s.filters[0].key).toBe('channel')
    expect(s.dateRange).toEqual({ label: 'Date range' })
  })
})
