import { describe, it, expect } from 'vitest'
import { upiPayUri } from '@/lib/payments/upi/pay-uri'

describe('upiPayUri', () => {
  it('builds an upi://pay deep link with amount in rupees and INR currency', () => {
    const uri = upiPayUri({ vpa: 'shop@okhdfc', payeeName: 'Jeffi Stores', amountPaise: 5000, reference: 'ORD-1' })
    expect(uri.startsWith('upi://pay?')).toBe(true)
    const q = new URLSearchParams(uri.split('?')[1])
    expect(q.get('pa')).toBe('shop@okhdfc')
    expect(q.get('pn')).toBe('Jeffi Stores')
    expect(q.get('am')).toBe('50.00') // 5000 paise → 50.00
    expect(q.get('cu')).toBe('INR')
    expect(q.get('tn')).toBe('ORD-1')
  })

  it('truncates payee name to 50 chars and cleans the note (allowed chars, 40 max)', () => {
    const uri = upiPayUri({ vpa: 'a@b', payeeName: 'N'.repeat(80), amountPaise: 100, reference: 'pay/ment#@!twenty_chars.ok-' + 'z'.repeat(60) })
    const q = new URLSearchParams(uri.split('?')[1])
    expect(q.get('pn')!.length).toBe(50)
    const tn = q.get('tn')!
    expect(tn.length).toBeLessThanOrEqual(40)
    // '/', '#', '@', '!' stripped; allowed set keeps letters, digits, space, _ . -
    expect(tn).not.toMatch(/[/#@!]/)
    expect(tn.startsWith('payment')).toBe(true)
  })

  it('falls back to "Payment" when the note cleans to nothing', () => {
    const q = new URLSearchParams(upiPayUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 100, reference: '@@@###' }).split('?')[1])
    expect(q.get('tn')).toBe('Payment')
  })

  it('rounds amount to two decimals', () => {
    const q = new URLSearchParams(upiPayUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 12345, reference: 'r' }).split('?')[1])
    expect(q.get('am')).toBe('123.45')
  })
})
