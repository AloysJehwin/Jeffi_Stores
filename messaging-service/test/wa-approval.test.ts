import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db.js', () => ({ db: {} }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))

const { composeTypes, validateForMeta, samplesFor, metaName, renumberForSubmit } = await import('../src/wa-approval')

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
    const ok = 'Your order {{1}} is confirmed. Thank you for shopping — {{2}} appreciates it.'
    expect(validateForMeta(ok, {}, samplesFor(ok))).toEqual([])
  })

  it('explains a reason-less rejection of a body with named variables', async () => {
    const { rejectionHints } = await import('@jeffi/api-contracts')
    expect(rejectionHints('Hi {firstName}, we are launching a new product please check it out {cta}', {}, 'MARKETING'))
      .toEqual(['WhatsApp variables are numbered: replace {firstName}, {cta} with {{1}}, {{2}} … in order ({{brand_name}} is the only named one).'])
  })

  it('renumbers header media and button placeholders to continue the body at submit time', async () => {
    const { validateForMeta: vfm, metaSamples } = await import('@jeffi/api-contracts')
    // Body uses {{1}}, {{2}}; header media stored as {{1}}; URL button stored as {{1}}.
    const body = 'Hi {{1}}, your order {{2}} ships — from Jeffi team.'
    const blocks = {
      types: { 'twilio/media': { media: ['https://cdn.jeffi/{{1}}.png'] } },
      buttons: [{ type: 'url' as const, label: 'Track', value: 'https://jeffi/t/{{1}}' }],
      variables: { 1: 'order-123.png' },
    }
    const samples = { 1: 'Priya', 2: 'JS-10234' }
    const out = renumberForSubmit(body, blocks, samples)
    expect(out.blocks.types!['twilio/media'].media[0]).toBe('https://cdn.jeffi/{{3}}.png')
    expect(out.blocks.buttons![0].value).toBe('https://jeffi/t/{{4}}')
    // Body's own samples at 1, 2 stay; header/button each get a new slot.
    expect(out.samples[1]).toBe('Priya')
    expect(out.samples[2]).toBe('JS-10234')
    expect(out.samples[3]).toBeDefined()
    expect(out.samples[4]).toBeDefined()
    // Outbound passes Meta's rules.
    expect(vfm(body, out.blocks, metaSamples(body, out.blocks))).toEqual([])
  })

  it('renumbers button-only (no header) starting at bodyMax+1', () => {
    const body = 'Hi {{1}}, your order {{2}} ships — from Jeffi team.'
    const blocks = {
      buttons: [{ type: 'url' as const, label: 'Track', value: 'https://jeffi/t/{{1}}' }],
    }
    const out = renumberForSubmit(body, blocks, { 1: 'Priya', 2: 'JS-10234' })
    expect(out.blocks.buttons![0].value).toBe('https://jeffi/t/{{3}}')
    expect(out.samples[1]).toBe('Priya')
    expect(out.samples[2]).toBe('JS-10234')
  })

  it('is a no-op when there are no header or button placeholders', () => {
    const body = 'Hi {{1}}, your order {{2}} is confirmed — from Jeffi team.'
    const blocks = { buttons: [{ type: 'url' as const, label: 'Shop', value: 'https://jeffi/shop' }] }
    const samples = { 1: 'Priya', 2: 'JS-10234' }
    const out = renumberForSubmit(body, blocks, samples)
    expect(out.blocks.buttons![0].value).toBe('https://jeffi/shop')
    expect(out.samples).toEqual(samples)
  })

  it('derives samples from context and names per tenant/version', () => {
    expect(samplesFor('Hi {{1}}, your order {{2}} ships. Track here: {{3}} today.')).toEqual({ 1: 'Priya', 2: 'JS-10234', 3: 'https://jeffistores.in/account/orders' })
    expect(metaName('testco', 'order/confirmed', 3)).toBe('testco_order_confirmed_v3')
    expect(metaName('platform', 'order/confirmed', 1)).toBe('jeffi_order_confirmed_v1')
  })
})
