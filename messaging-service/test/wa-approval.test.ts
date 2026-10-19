import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db.js', () => ({ db: {} }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))

const { composeTypes, validateForMeta, samplesFor, metaName } = await import('../src/wa-approval')

describe('wa-approval', () => {
  it('composes the saved body, not stale blocks text', () => {
    expect(composeTypes('New text {{1}} here.', { types: { 'twilio/text': { body: 'OLD' } } })).toEqual({ 'twilio/text': { body: 'New text {{1}} here.' } })
  })

  it('maps media + buttons to a card, url buttons to call-to-action', () => {
    const media = { types: { 'twilio/media': { media: ['https://x/a.png'] } }, buttons: [{ type: 'url' as const, label: 'Shop', value: 'https://x' }] }
    expect(Object.keys(composeTypes('Hi there.', media))).toEqual(['twilio/card'])
    expect(Object.keys(composeTypes('Hi there.', { buttons: media.buttons }))).toEqual(['twilio/call-to-action'])
  })

  it('flags Meta rejection causes', () => {
    const errs = validateForMeta('{{1}} order {{3}}', {}, {})
    expect(errs.join(' ')).toMatch(/start with a variable/)
    expect(errs.join(' ')).toMatch(/end with a variable/)
    expect(errs.join(' ')).toMatch(/numbered/)
    expect(errs.join(' ')).toMatch(/sample value/)
    const ok = '{{1}}: Your order {{2}} is confirmed. Thank you for shopping with us!'
    expect(validateForMeta(ok, {}, samplesFor(ok))).toEqual([])
  })

  it('explains a reason-less rejection of a body with named variables', async () => {
    const { rejectionHints } = await import('@jeffi/api-contracts')
    expect(rejectionHints('Hi {firstName}, we are launching a new product please check it out {cta}', {}, 'MARKETING'))
      .toEqual(['WhatsApp variables are numbered: replace {firstName}, {cta} with {{1}}, {{2}} … in order.'])
  })

  it('derives samples from context and names per tenant/version', () => {
    expect(samplesFor('Hi {{1}}, your order {{2}} ships. Track here: {{3}} today.')).toEqual({ 1: 'Priya', 2: 'JS-10234', 3: 'https://jeffistores.in/account/orders' })
    expect(metaName('testco', 'order/confirmed', 3)).toBe('testco_order_confirmed_v3')
    expect(metaName('platform', 'order/confirmed', 1)).toBe('jeffi_order_confirmed_v1')
  })
})
