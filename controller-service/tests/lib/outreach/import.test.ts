import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const pool = { query: vi.fn(), connect: async () => client }
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveGoogleSheetsCreds: vi.fn() }))
vi.mock('@/lib/shared/google-sheets', () => ({ listSheetTitles: vi.fn(), readSheetValues: vi.fn(), wholeSheetRange: (t: string) => `'${t}'!A:ZZ` }))

import { normalizePhone } from '@controller/lib/outreach/phone'
import { matrixToRows, validateRow, importRows, parseContactFile, ImportError } from '@controller/lib/outreach/import'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['9876543210.0', '+919876543210'],
  ])('normalises %s', (raw, out) => expect(normalizePhone(raw)).toBe(out))

  it.each(['', '12345', '5876543210', '+14155550123', 'abc', null, undefined])('rejects %s', raw => expect(normalizePhone(raw)).toBeNull())
})

const ok = { business_name: 'Sri Tailors', phone: '98765 43210', source: 'maps-scrape-nov' }

describe('validateRow', () => {
  const none = new Set<string>()
  const reason = (v: Record<string, string>, s = none) => {
    const r = validateRow(2, v, s)
    return r.ok ? null : r.rejection.reason
  }

  it('accepts a good row and normalises it', () => {
    const r = validateRow(2, { ...ok, language: 'TA', dnd_status: 'clear', notes: 'ask for Raju', colour: 'red', google_maps_url: 'https://maps/x' }, none)
    expect(r.ok && r.contact).toMatchObject({ phone: '+919876543210', language: 'ta', dnd_status: 'clear', extra: { notes: 'ask for Raju', colour: 'red', google_maps_url: 'https://maps/x' } })
  })

  it('rejects with a reason per failure', () => {
    expect(reason({ ...ok, business_name: '' })).toMatch(/business_name/)
    expect(reason({ ...ok, source: '' })).toMatch(/source/)
    expect(reason({ ...ok, phone: '12345' })).toMatch(/valid Indian mobile/)
    expect(reason({ ...ok, website: 'https://sri.in' })).toMatch(/website/)
    expect(reason(ok, new Set(['+919876543210']))).toMatch(/suppression/)
    expect(reason({ ...ok, dnd_status: 'dnd' })).toMatch(/DND/)
  })

  it('treats a placeholder website as none and an unknown language as unset', () => {
    const r = validateRow(2, { ...ok, website: 'N/A', language: 'fr' }, none)
    expect(r.ok && r.contact.language).toBeNull()
  })
})

describe('matrixToRows', () => {
  it('maps headers case-insensitively and numbers rows from the sheet', () => {
    const out = matrixToRows([['Business Name', 'PHONE', 'Source'], ['A', '9876543210', 's'], ['', '', ''], ['B', '9123456780', 's']])
    expect(out.rows.map(r => [r.row, r.values.business_name])).toEqual([[2, 'A'], [4, 'B']])
  })

  it('is fatal without the required columns', () => {
    expect(matrixToRows([['business_name', 'phone'], ['A', '1']]).fatal).toMatch(/source/)
    expect(matrixToRows([]).fatal).toMatch(/empty/)
  })

  it('reads a CSV upload and refuses a non-spreadsheet one', () => {
    const csv = Buffer.from('business_name,phone,source\nSri Tailors,9876543210,scrape\n')
    expect(parseContactFile(csv, 'c.csv').rows[0].values).toMatchObject({ business_name: 'Sri Tailors', phone: '9876543210' })
    expect(() => parseContactFile(Buffer.from('x'), 'c.pdf')).toThrow(ImportError)
  })
})

describe('importRows', () => {
  const raw = (rows: Record<string, string>[]) => rows.map((values, i) => ({ row: i + 2, values }))

  it('upserts good rows, reports rejections and duplicates, and never resets progress', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ phone: '+919123456780' }] })
    let n = 0
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO outreach_contacts')) return { rows: [{ inserted: n++ === 0 }] }
      return { rows: [] }
    })
    const out = await importRows('l1', 'showcase-offer', raw([
      ok,
      { ...ok, business_name: 'Sri Tailors 2' },
      { business_name: 'Existing', phone: '9811111111', source: 's' },
      { business_name: 'Supp', phone: '9123456780', source: 's' },
      { business_name: 'Site', phone: '9822222222', source: 's', website: 'x.in' },
    ]), 'admin:1')
    expect(out).toMatchObject({ total: 5, inserted: 1, updated: 1, rejected: 3 })
    expect(out.rejections.map(r => r.row)).toEqual([3, 5, 6])
    expect(out.rejections[0].reason).toMatch(/Duplicate/)

    const upsert = client.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO outreach_contacts'))![0] as string
    expect(upsert).toContain('ON CONFLICT (program, phone) DO UPDATE')
    // progress columns are untouched on conflict; status moves only out of `new`
    const conflict = upsert.split('DO UPDATE SET')[1]
    expect(conflict).not.toMatch(/attempts\s*=/)
    expect(conflict).toContain("CASE WHEN outreach_contacts.status = 'new' THEN 'queued' ELSE outreach_contacts.status END")
    expect(conflict).not.toMatch(/last_call_id|consent_|showcase_site_id|claim_/)
    const sqls = client.query.mock.calls.map(c => c[0] as string)
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls.at(-1)).toBe('COMMIT')
    expect(sqls.some(s => s.includes('outreach_events'))).toBe(true)
  })

  it('rolls back when a write fails', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO outreach_contacts')) throw new Error('boom')
      return { rows: [] }
    })
    await expect(importRows('l1', 'showcase-offer', raw([ok]), 'a')).rejects.toThrow('boom')
    expect(client.query.mock.calls.map(c => c[0])).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})
