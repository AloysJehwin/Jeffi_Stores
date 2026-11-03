import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { extractSpreadsheetId, valuesToWorkbookBuffer } from '@/lib/import/google-sync'

describe('extractSpreadsheetId', () => {
  it('accepts a URL or a bare id and rejects junk', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0')).toBe('1AbC-_9')
    expect(extractSpreadsheetId('  1AbC-_9 ')).toBe('1AbC-_9')
    expect(extractSpreadsheetId('not a sheet!')).toBe('')
  })
})

describe('valuesToWorkbookBuffer', () => {
  it('keeps every template tab by title', () => {
    const buf = valuesToWorkbookBuffer({
      Products: [['sku'], ['A']],
      'Product · Shipping': [['sku', 'weight_grams']],
      Variants: [],
    })
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Products', 'Product · Shipping', 'Variants'])
  })

  it('wraps a single matrix as the Products tab', () => {
    const wb = XLSX.read(
      valuesToWorkbookBuffer([
        ['row_type', 'sku'],
        ['product', 'A'],
      ]),
      { type: 'buffer' }
    )
    expect(wb.SheetNames).toEqual(['Products'])
  })
})
