import { describe, it, expect } from 'vitest'
import { autoMap, normHeader, parseDate, parseNumber, parsePercent, reportKind } from '@/lib/marketplace-ads/columns'

describe('marketplace ads columns', () => {
  it('maps Myntra report headers through the synonyms', () => {
    const headers = ['Date', 'Campaign Name', 'Campaign ID', 'Style ID', 'Impressions', 'Clicks', 'Budget Spent (₹)', 'Units Sold', 'Revenue (INR)', 'ROI']
    expect(autoMap(headers, 'myntra')).toEqual({
      date: 'Date',
      campaign_name: 'Campaign Name',
      campaign_id: 'Campaign ID',
      style_id: 'Style ID',
      impressions: 'Impressions',
      clicks: 'Clicks',
      spend: 'Budget Spent (₹)',
      units: 'Units Sold',
      sales: 'Revenue (INR)',
    })
  })

  it('maps AJIO-only headers and keeps each header on one field', () => {
    const m = autoMap(['Report Date', 'Campaign', 'Option Code', 'Ad Spends', 'Converted Orders', 'Ad GMV'], 'ajio')
    expect(m).toMatchObject({ date: 'Report Date', campaign_name: 'Campaign', style_id: 'Option Code', spend: 'Ad Spends', orders: 'Converted Orders', sales: 'Ad GMV' })
    expect(autoMap(['Option Code'], 'myntra').style_id).toBeUndefined()
  })

  it('prefers the saved mapping when the file has that header', () => {
    const headers = ['Day', 'Cost', 'Spend', 'Campaign']
    expect(autoMap(headers, 'myntra', { spend: 'Cost' }).spend).toBe('Cost')
    expect(autoMap(headers, 'myntra', { spend: 'Gone' }).spend).toBe('Spend')
  })

  it('normalises headers and picks the report kind', () => {
    expect(normHeader('  Spend (₹) ')).toBe('spend')
    expect(normHeader('Ad-Spend [INR]')).toBe('ad spend')
    expect(reportKind({ spend: 'x', campaign_name: 'y' })).toBe('campaign')
    expect(reportKind({ spend: 'x', style_id: 'y' })).toBe('product')
  })

  it('parses rupee amounts, Indian commas, suffixes and percentages', () => {
    expect(parseNumber('₹1,23,456.50')).toBe(123456.5)
    expect(parseNumber('Rs. 500')).toBe(500)
    expect(parseNumber('2,000 INR')).toBe(2000)
    expect(parseNumber('(1,200)')).toBe(-1200)
    expect(parseNumber('1.2L')).toBeCloseTo(120000)
    expect(parseNumber('3.5K')).toBe(3500)
    expect(parseNumber('12.5%')).toBe(0.125)
    expect(parseNumber(42)).toBe(42)
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber('abc')).toBeNaN()
    expect(parsePercent('12.5%')).toBe(0.125)
    expect(parsePercent(12.5)).toBe(0.125)
    expect(parsePercent(0.125)).toBe(0.125)
  })

  it('reads dd-mm-yyyy and the other date forms reports use', () => {
    expect(parseDate('05-10-2026')).toBe('2026-10-05')
    expect(parseDate('05/10/26')).toBe('2026-10-05')
    expect(parseDate('5.10.2026')).toBe('2026-10-05')
    expect(parseDate('13/10/2026')).toBe('2026-10-13')
    expect(parseDate('10/13/2026')).toBe('2026-10-13')
    expect(parseDate('2026-10-05')).toBe('2026-10-05')
    expect(parseDate('2026/10/05 13:45:00')).toBe('2026-10-05')
    expect(parseDate('2026-10-05T00:00:00Z')).toBe('2026-10-05')
    expect(parseDate('20261005')).toBe('2026-10-05')
    expect(parseDate('5 Oct 2026')).toBe('2026-10-05')
    expect(parseDate('05-Oct-2026')).toBe('2026-10-05')
    expect(parseDate('5th September 2026')).toBe('2026-09-05')
    expect(parseDate('Oct 5, 2026')).toBe('2026-10-05')
    expect(parseDate(45658)).toBe('2025-01-01')
    expect(parseDate('31-02-2026')).toBeNull()
    expect(parseDate('Total')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})
