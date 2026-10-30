import { describe, it, expect } from 'vitest'
import { isDigitalLine, digitalLinesSubtotal } from '@/components/visitor/cart/digital-lines'

const physical = { quantity: 2, products: { base_price: 100, price_ex_gst: 85 } }
const digital = { quantity: 1, is_digital: true, products: { base_price: 499, price_ex_gst: 423, is_digital: true } }

describe('cart digital-lines', () => {
  it('detects digital lines from the line or product flag', () => {
    expect(isDigitalLine(physical)).toBe(false)
    expect(isDigitalLine(digital)).toBe(true)
    expect(isDigitalLine({ quantity: 1, products: { is_digital: true } })).toBe(true)
  })

  it('sums only digital lines, honouring the GST flag', () => {
    expect(digitalLinesSubtotal([physical, digital], true)).toBe(499)
    expect(digitalLinesSubtotal([physical, digital], false)).toBe(423)
    expect(digitalLinesSubtotal([physical], true)).toBe(0)
  })
})
