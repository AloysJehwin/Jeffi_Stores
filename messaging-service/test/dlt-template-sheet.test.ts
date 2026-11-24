import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-expect-error plain .mjs script
import { COLUMNS, encodingOf, lengthOf, rowsFor, segmentsOf, toCsv, toDltBody } from '../../scripts/dlt-template-sheet.mjs'
import { CATALOG } from '../seed/catalog.js'

// A small RFC 4180 reader: quoted cells, doubled quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  return rows
}

describe('dlt-template-sheet', () => {
  const rows = rowsFor(CATALOG)

  it('turns every {{var}} and {var} into {#var#}', () => {
    expect(toDltBody('{{store_name}}: Order #{{order_number}} Rs. {{total}}')).toBe('{#var#}: Order #{#var#} Rs. {#var#}')
    expect(toDltBody('{headline}{#if couponCode} use code {couponCode}{/if}.')).toBe('{#var#} use code {#var#}.')
    for (const r of rows) expect(r.dlt_body).not.toMatch(/\{\{|\{(?!#var#\})/)
  })

  it('writes a CSV that parses, one row per SMS template, with the header JEFFIS', () => {
    const parsed = parseCsv(toCsv(rows))
    expect(parsed[0]).toEqual(COLUMNS)
    expect(parsed.length - 1).toBe(CATALOG.filter(t => t.channel === 'sms').length)
    for (const r of parsed.slice(1)) {
      expect(r).toHaveLength(COLUMNS.length)
      expect(r[2]).toBe('JEFFIS')
      expect(['Transactional', 'Service-Implicit', 'Service-Explicit', 'Promotional']).toContain(r[1])
    }
  })

  it('counts encoding and segments: a rupee sign forces UCS-2, 70 then 67 per part', () => {
    expect(encodingOf('Rs. 100')).toBe('GSM-7')
    expect(encodingOf('₹100')).toBe('UCS-2')
    expect(encodingOf('a — b')).toBe('UCS-2')
    expect(lengthOf('{a}', 'GSM-7')).toBe(5)
    expect(segmentsOf(160, 'GSM-7')).toBe(1)
    expect(segmentsOf(161, 'GSM-7')).toBe(2)
    expect(segmentsOf(70, 'UCS-2')).toBe(1)
    expect(segmentsOf(71, 'UCS-2')).toBe(2)
  })

  it("the store's own SMS templates are all GSM-7 single segments", () => {
    const own = rows.filter((r: { slug: string }) => !r.slug.startsWith('campaign/'))
    expect(own.filter((r: { encoding: string; segments: number }) => r.encoding !== 'GSM-7' || r.segments !== 1)).toEqual([])
  })

  it('docs/DLT_SMS_TEMPLATES.csv is the current output', () => {
    const file = readFileSync(resolve(__dirname, '../../docs/DLT_SMS_TEMPLATES.csv'), 'utf8')
    expect(file).toBe(toCsv(rows))
  })
})
