import { describe, it, expect } from 'vitest'
import { DESIGNS, renderDocument, resolveDesign } from '../src/designs/index.js'
import { sampleRequest } from '../src/designs/sample.js'
import { computeTotals } from '../src/totals.js'

const TYPES = ['invoice', 'quotation', 'receipt', 'packing_slip', 'label', 'purchase_order'] as const

describe('document designs', () => {
  it('legacy layout keys resolve', () => {
    expect(resolveDesign('classic')?.design.key).toBe('ledger')
    expect(resolveDesign('thermal-80mm')?.thermal).toBe(true)
    expect(resolveDesign(undefined)?.design.key).toBe('aurora')
    expect(resolveDesign('nope')).toBeNull()
  })

  it('every design renders every type', async () => {
    for (const d of DESIGNS) for (const type of TYPES) {
      const req = sampleRequest(type)
      const pdf = await renderDocument(d.key, type, req, computeTotals(req), 'INV/1', 'https://x.test/d/abc', { accent: '#112233', font: 'editorial' })
      expect(pdf.subarray(0, 4).toString(), `${d.key}/${type}`).toBe('%PDF')
    }
  }, 60_000)
})
