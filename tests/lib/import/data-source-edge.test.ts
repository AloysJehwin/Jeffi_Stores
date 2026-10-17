import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))

import { parseWorkbook } from '@/lib/import/parse'
import { groupRows, summarizeRows } from '@/lib/import/validate-row'
import { checkImportFile, IMPORT_MAX_BYTES } from '@/lib/import/file-check'
import { imageUrlProblem } from '@/lib/import/image-url'
import { describeGoogleFailure } from '@/lib/import/google-sync'
import { buildTemplateWorkbook, buildTemplateCsv } from '@/lib/import/template'
import { fillCreateDefaults } from '@/lib/import/to-draft'
import { rowErrorMessage } from '@/lib/catalog/product-import'
import { GoogleApiError } from '@/lib/shared/google-sheets'

function book(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('template round trip', () => {
  it('the downloaded xlsx parses, and its example rows are skipped unless asked for', async () => {
    const buf = await buildTemplateWorkbook()
    const skipped = parseWorkbook(buf)
    expect(skipped.fatal).toMatch(/example rows/)
    const kept = parseWorkbook(buf, { keepTemplateExample: true })
    expect(kept.fatal).toBeUndefined()
    const { groups } = groupRows(kept.rows)
    expect(groups[0].errors).toEqual([])
  })

  it('the csv template header is accepted and its help row is not read as data', () => {
    const buf = Buffer.from(buildTemplateCsv())
    expect(checkImportFile('template.csv', buf)).toBeNull()
    expect(parseWorkbook(buf).fatal).toMatch(/No data rows/)
    const filled = Buffer.from(buildTemplateCsv() + 'product,,,,CSV-1,CSV one\r\n')
    const header = buildTemplateCsv().split('\r\n')[0].split(',')
    expect(header.slice(0, 6)).toEqual(['row_type', 'parent_sku', 'variant_sku', 'image_urls', 'sku', 'name'])
    const parsed = parseWorkbook(filled)
    expect(parsed.fatal).toBeUndefined()
    expect(parsed.rows[0].values).toMatchObject({ sku: 'CSV-1', name: 'CSV one' })
  })
})

describe('parse: header problems', () => {
  it('a renamed required header is a whole-file error naming the column', () => {
    const r = parseWorkbook(book({ Products: [['code', 'name'], ['A', 'B']] }))
    expect(r.fatal).toMatch(/missing the column "sku"/)
  })

  it('unknown and misplaced columns import with a warning', () => {
    const r = parseWorkbook(book({ Products: [['sku', 'name', 'colour_xyz'], ['A', 'B', 'x']] }))
    expect(r.fatal).toBeUndefined()
    expect(r.warnings?.[0]).toMatch(/unknown column "colour_xyz"/)
  })

  it('an empty workbook is a fatal error', () => {
    expect(parseWorkbook(book({ Products: [['sku', 'name']] })).fatal).toMatch(/No data rows/)
  })
})

describe('validate rows', () => {
  const rows = (products: unknown[][], variants?: unknown[][]) =>
    parseWorkbook(
      book({
        Products: [['sku', 'name', 'base_price', 'stock_status', 'image_urls'], ...products],
        ...(variants ? { Variants: [['parent_sku', 'variant.sku', 'variant.variant_name'], ...variants] } : {}),
      })
    ).rows

  it('flags missing sku, bad number, negative, bad enum and duplicate sku per row', () => {
    const { groups } = groupRows(
      rows([
        ['', 'No sku', 1, '', ''],
        ['N1', 'Bad number', 'abc', '', ''],
        ['N2', 'Negative', -1, '', ''],
        ['N3', 'Bad enum', 1, 'Maybe', ''],
        ['N4', 'Ok', 1, 'in stock', ''],
        ['N4', 'Dup', 1, '', ''],
      ])
    )
    const e = Object.fromEntries(groups.map((g, i) => [i, g.errors.join('; ')]))
    expect(e[0]).toMatch(/missing sku/)
    expect(e[1]).toMatch(/not a number/)
    expect(e[2]).toMatch(/cannot be negative/)
    expect(e[3]).toMatch(/stock_status "Maybe"/)
    expect(e[4]).toBe('')
    expect(groups[4].values.stock_status).toBe('In Stock')
    expect(e[5]).toMatch(/duplicate product sku "N4"/)
  })

  it('drops unusable image URLs with a warning instead of failing the row', () => {
    const { groups } = groupRows(rows([['I1', 'Img', 1, '', 'https://cdn.example.com/a.jpg|http://10.0.0.1/x.png|nope']]))
    expect(groups[0].errors).toEqual([])
    expect(groups[0].imageUrls).toEqual(['https://cdn.example.com/a.jpg'])
    expect(groups[0].warnings).toHaveLength(2)
  })

  it('a variant whose parent is not in the file is reported with its sheet and sku', () => {
    const r = rows([['P1', 'Parent', 1, '', '']], [['P1', 'P1-A', 'A'], ['NOPE', 'X-1', 'x']])
    const { groups, orphans } = groupRows(r)
    expect(groups[0].variants).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ sheet: 'Variants', sku: 'X-1' })
    expect(summarizeRows(r)).toEqual({ units: 2, products: 1, invalid: 1 })
  })
})

describe('file check', () => {
  const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])
  it('rejects empty, oversize, wrong extension and mismatched bytes', () => {
    expect(checkImportFile('a.xlsx', Buffer.alloc(0))?.status).toBe(400)
    expect(checkImportFile('a.xlsx', Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x50))?.status).toBe(413)
    expect(checkImportFile('a.pdf', xlsx)?.status).toBe(415)
    expect(checkImportFile('a.xlsx', Buffer.from('sku,name\n'))?.status).toBe(415)
    expect(checkImportFile('a.csv', xlsx)?.status).toBe(415)
    expect(checkImportFile('a.xlsx', xlsx)).toBeNull()
    expect(checkImportFile('A.CSV', Buffer.from('sku,name\n'))).toBeNull()
  })
})

describe('image URLs', () => {
  it('only public http(s) hosts pass', () => {
    expect(imageUrlProblem('https://cdn.example.com/a.png')).toBeNull()
    expect(imageUrlProblem('ftp://x/a.png')).toMatch(/http/)
    expect(imageUrlProblem('http://localhost/a.png')).toMatch(/private/)
    expect(imageUrlProblem('http://169.254.169.254/latest')).toMatch(/private/)
    expect(imageUrlProblem('http://[::1]/a')).toMatch(/private/)
    expect(imageUrlProblem('not a url')).toMatch(/valid URL/)
  })
})

describe('Google failures', () => {
  it('maps each failure to an actionable status without the raw message', () => {
    expect(describeGoogleFailure(new Error('Google Sheets token refresh failed: invalid_grant'))).toMatchObject({ code: 'reauth', status: 409 })
    // A refresh that failed for another reason is not a revoked grant.
    expect(describeGoogleFailure(new Error('Google Sheets token refresh failed: token_refresh_failed')).code).toBe('unknown')
    expect(describeGoogleFailure(new GoogleApiError('Requested entity was not found.', 404))).toMatchObject({ code: 'not_found', status: 404 })
    expect(describeGoogleFailure(new GoogleApiError('The caller does not have permission', 403)).code).toBe('no_access')
    expect(describeGoogleFailure(new GoogleApiError('Request had insufficient authentication scopes.', 403)).code).toBe('scope')
    expect(describeGoogleFailure(new GoogleApiError('Quota exceeded', 429))).toMatchObject({ code: 'rate_limited', status: 429 })
    expect(describeGoogleFailure(new GoogleApiError('backend', 503)).status).toBe(502)
    const f = describeGoogleFailure(new Error('secret internal detail xyz'))
    expect(f.error).not.toMatch(/xyz/)
  })
})

describe('create defaults and row errors', () => {
  it('a new product takes NOT NULL defaults from its skeleton and derives discount', () => {
    const f = fillCreateDefaults({ mrp: 200, base_price: 150, handling_days: undefined }, { handling_days: 2, sku: 'X', discount_pct: 0 }, ['handling_days', 'sku', 'discount_pct'])
    expect(f).toMatchObject({ handling_days: 2, discount_pct: 25 })
    expect(f.sku).toBeUndefined()
  })

  it('database errors become fixable messages', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(rowErrorMessage({ code: '23505', constraint: 'products_sku_key', message: 'dup' })).toMatch(/SKU is already used/)
    expect(rowErrorMessage({ code: '22003', message: 'numeric field overflow' })).toMatch(/too large/)
    expect(rowErrorMessage({ code: '42P01', message: 'relation x does not exist' })).not.toMatch(/relation/)
    expect(rowErrorMessage(new Error('category "Foo" not found'))).toBe('category "Foo" not found')
  })
})
