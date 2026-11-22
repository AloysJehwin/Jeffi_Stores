import { describe, it, expect } from 'vitest'
import {
  placeholders,
  extraSlots,
  withBrandToken,
  planSlots,
  validateForMeta,
  samplesFor,
  metaSamples,
  rejectionHints,
  BRAND_VAR,
  BRAND_SAMPLE,
  type WaBlocks,
} from '../src/whatsapp-rules'

describe('placeholders', () => {
  it('extracts unique sorted numeric slots', () => {
    expect(placeholders('{{2}} then {{1}} and {{2}} again')).toEqual(['1', '2'])
  })
  it('tolerates spaces inside braces', () => {
    expect(placeholders('{{ 3 }}')).toEqual(['3'])
  })
  it('returns [] for empty/no placeholders', () => {
    expect(placeholders('')).toEqual([])
    expect(placeholders('no vars here')).toEqual([])
  })
})

describe('extraSlots', () => {
  it('collects {{n}} from header media and button values', () => {
    const blocks: WaBlocks = {
      types: { 'twilio/media': { media: ['{{4}}'] } },
      buttons: [{ type: 'url', label: 'Go', value: '{{5}}' }],
    }
    expect(extraSlots(blocks)).toEqual(['4', '5'])
  })
  it('handles null/empty blocks and buttons without values', () => {
    expect(extraSlots(null)).toEqual([])
    expect(extraSlots({})).toEqual([])
    expect(extraSlots({ buttons: [{ type: 'quick_reply', label: 'Q' }] })).toEqual([])
  })
})

describe('withBrandToken', () => {
  it('rewrites the legacy "— from {{N}} team" tail when N is the last slot', () => {
    const body = 'Hello {{1}}, your order {{2}} shipped. — from {{3}} team'
    expect(withBrandToken(body)).toBe('Hello {{1}}, your order {{2}} shipped. — from {{brand_name}} team')
  })
  it('preserves trailing whitespace captured by the tail', () => {
    const body = 'Hi {{1}} — from {{2}} team  '
    expect(withBrandToken(body)).toBe('Hi {{1}} — from {{brand_name}} team  ')
  })
  it('leaves the body untouched when there is no legacy tail', () => {
    expect(withBrandToken('Hi {{1}}')).toBe('Hi {{1}}')
    expect(withBrandToken('')).toBe('')
  })
  it('does nothing when brand_name is already present', () => {
    const body = 'Hi {{1}} — from {{brand_name}} team'
    expect(withBrandToken(body)).toBe(body)
  })
  it('does nothing when the tail number is not the last slot', () => {
    // {{9}} appears mid-text, so the tail {{2}} is not the highest slot → no rewrite.
    const body = 'Big {{9}} news {{1}} — from {{2}} team'
    expect(withBrandToken(body)).toBe(body)
  })
})

describe('planSlots', () => {
  it('numbers brand_name after the body vars and fills its sample', () => {
    const plan = planSlots('Hi {{1}}, order {{2}} — from {{brand_name}} team', null, { '1': 'Priya', '2': 'JS-1' })
    expect(plan.brandSlot).toBe('3')
    expect(plan.body).toBe('Hi {{1}}, order {{2}} — from {{3}} team')
    expect(plan.bodySlots).toEqual(['1', '2'])
    expect(plan.samples['3']).toBe(BRAND_SAMPLE)
    expect(plan.samples['1']).toBe('Priya')
  })
  it('leaves brandSlot null and body unchanged when no brand token', () => {
    const plan = planSlots('Hi {{1}}', null, {})
    expect(plan.brandSlot).toBeNull()
    expect(plan.body).toBe('Hi {{1}}')
  })
  it('relocates header media placeholders to continue after the body/brand', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{1}}'] } }, variables: { '1': 'http://img' } }
    const plan = planSlots('Hi {{1}} — from {{brand_name}} team', blocks, { '1': 'Priya' })
    // body slot 1, brand 2, header relocated to 3
    expect(plan.brandSlot).toBe('2')
    expect(plan.media).toEqual({ from: '1', to: '3' })
    expect((plan.blocks.types as any)['twilio/media'].media[0]).toBe('{{3}}')
    expect(plan.samples['3']).toBe('http://img')
  })
  it('relocates each button, mapping its first variable, and keeps value-less buttons', () => {
    const blocks: WaBlocks = {
      buttons: [{ type: 'url', label: 'Track', value: 'order/{{1}}' }, { type: 'quick_reply', label: 'Yes' }],
    }
    const plan = planSlots('Hi {{1}}', blocks, { '1': 'Priya' })
    // body slot 1 (no brand), button relocated to 2
    expect(plan.links).toEqual([{ from: '1', to: '2' }, null])
    expect(plan.blocks.buttons![0].value).toBe('order/{{2}}')
    expect(plan.blocks.buttons![1]).toEqual({ type: 'quick_reply', label: 'Yes' })
  })
  it('preserves later media entries past index 0', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{1}}', 'keep.png'] } } }
    const plan = planSlots('Hi {{1}}', blocks, {})
    expect((plan.blocks.types as any)['twilio/media'].media).toEqual(['{{2}}', 'keep.png'])
  })
  it('prefers block variables over samples for relocated slots', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{1}}'] } }, variables: { '1': 'from-block' } }
    const plan = planSlots('Body {{1}}', blocks, { '1': 'from-samples' })
    // body slot 1 keeps the sample; header relocated to 2 uses block variable
    expect(plan.samples['2']).toBe('from-block')
  })
})

describe('validateForMeta', () => {
  const ok = 'Hello {{1}}, your order has shipped and will arrive soon enough.'
  it('passes a clean utility-style body', () => {
    expect(validateForMeta(ok, null, { '1': 'Priya' })).toEqual([])
  })
  it('flags an empty body', () => {
    expect(validateForMeta('   ', null, {})).toContain('Body is empty.')
  })
  it('flags a body over 1024 characters', () => {
    const long = 'a'.repeat(1100)
    expect(validateForMeta(long, null, {}).some(e => /1024/.test(e))).toBe(true)
  })
  it('flags a body that starts with a variable', () => {
    expect(validateForMeta('{{1}} hello there friend good day', null, { '1': 'x' })).toContain(
      'Body cannot start with a variable — add text before {{1}}.'
    )
  })
  it('flags a body that ends with a variable', () => {
    expect(validateForMeta('Your order total is {{1}}', null, { '1': 'x' })).toContain(
      'Body cannot end with a variable — add text after the last {{n}}.'
    )
  })
  it('flags named (non-numbered) variables', () => {
    const errs = validateForMeta('Hi {{name}}, order ready for pickup now please', null, {})
    expect(errs.some(e => /WhatsApp variables are numbered/.test(e))).toBe(true)
  })
  it('flags out-of-order numbering', () => {
    const errs = validateForMeta('Hello there dear {{2}} your order is ready now', null, { '2': 'x' })
    expect(errs.some(e => /in order \(found \{\{2\}\}\)/.test(e))).toBe(true)
  })
  it('flags too many variables for the message length', () => {
    const errs = validateForMeta('{{1}} {{2}} end', null, { '1': 'a', '2': 'b' })
    expect(errs).toContain('Too many variables for the message length — add more text around them.')
  })
  it('flags a missing body sample', () => {
    const errs = validateForMeta('Hello {{1}} your order has shipped out today', null, {})
    expect(errs).toContain('Add a sample value for {{1}}.')
  })
  it('accepts image/button slots once planSlots renumbers them to continue after the body', () => {
    // planSlots relocates a stored header {{5}} to the next slot after body ({{2}}),
    // so the "must continue the numbering" branch does not fire for a renumbered layout.
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{5}}'] } }, variables: { '5': 'http://i' } }
    const errs = validateForMeta('Hello {{1}} your order is ready for you now', blocks, { '1': 'x' })
    expect(errs.some(e => /Image\/button variables must continue the numbering/.test(e))).toBe(false)
  })
  it('flags a missing image/button sample', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{2}}'] } } }
    const errs = validateForMeta('Hello {{1}} your order is ready for you now', blocks, { '1': 'x' })
    expect(errs.some(e => /image path or link code/.test(e))).toBe(true)
  })
  it('flags more than 3 buttons', () => {
    const blocks: WaBlocks = {
      buttons: [
        { type: 'quick_reply', label: 'A' }, { type: 'quick_reply', label: 'B' },
        { type: 'quick_reply', label: 'C' }, { type: 'quick_reply', label: 'D' },
      ],
    }
    expect(validateForMeta(ok, blocks, { '1': 'Priya' })).toContain('At most 3 buttons.')
  })
  it('flags a button with no label', () => {
    const blocks: WaBlocks = { buttons: [{ type: 'quick_reply', label: '  ' }] }
    expect(validateForMeta(ok, blocks, { '1': 'Priya' })).toContain('Every button needs a label.')
  })
  it('flags an over-long button label', () => {
    const blocks: WaBlocks = { buttons: [{ type: 'quick_reply', label: 'x'.repeat(30) }] }
    expect(validateForMeta(ok, blocks, { '1': 'Priya' }).some(e => /over 25 characters/.test(e))).toBe(true)
  })
  it('flags a url button without https and a bad phone button', () => {
    const blocks: WaBlocks = {
      buttons: [
        { type: 'url', label: 'Open', value: 'http://x' },
        { type: 'phone', label: 'Call', value: '12345' },
      ],
    }
    const errs = validateForMeta(ok, blocks, { '1': 'Priya' })
    expect(errs.some(e => /needs an https:\/\/ URL/.test(e))).toBe(true)
    expect(errs.some(e => /needs a phone like/.test(e))).toBe(true)
  })
  it('accepts valid url and phone buttons', () => {
    const blocks: WaBlocks = {
      buttons: [
        { type: 'url', label: 'Open', value: 'https://jeffistores.in' },
        { type: 'phone', label: 'Call', value: '+919876543210' },
      ],
    }
    expect(validateForMeta(ok, blocks, { '1': 'Priya' })).toEqual([])
  })
  it('includes carousel card buttons in label/type checks', () => {
    const blocks: WaBlocks = { carousel: { cards: [{ buttons: [{ type: 'url', label: 'Buy', value: 'http://no' }] }] } }
    const errs = validateForMeta(ok, blocks, { '1': 'Priya' })
    expect(errs.some(e => /needs an https:\/\/ URL/.test(e))).toBe(true)
  })
})

describe('samplesFor', () => {
  it('keeps given samples that are non-empty', () => {
    expect(samplesFor('Hi {{1}}', { '1': 'Given' })).toEqual({ '1': 'Given' })
  })
  it('derives samples from the text before each slot', () => {
    expect(samplesFor('Track here {{1}}')['1']).toBe('https://jeffistores.in/account/orders')
    expect(samplesFor('Your order #{{1}}')['1']).toBe('JS-10234')
    expect(samplesFor('Total ₹{{1}}')['1']).toBe('₹2,499')
    expect(samplesFor('Use code {{1}}')['1']).toBe('WELCOME20')
    expect(samplesFor('Hi {{1}}')['1']).toBe('Priya')
  })
  it('falls back to "Sample text" when no context matches', () => {
    expect(samplesFor('xyz {{1}}')['1']).toBe('Sample text')
  })
  it('ignores whitespace-only given values', () => {
    expect(samplesFor('Hi {{1}}', { '1': '   ' })['1']).toBe('Priya')
  })
})

describe('metaSamples', () => {
  it('merges body samples with image/button slots taken from block variables', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{2}}'] } }, variables: { '2': 'http://img' } }
    const s = metaSamples('Hi {{1}}', blocks)
    expect(s['1']).toBe('Priya')
    expect(s['2']).toBe('http://img')
  })
  it('defaults an unset extra slot to empty string', () => {
    const blocks: WaBlocks = { types: { 'twilio/media': { media: ['{{2}}'] } } }
    expect(metaSamples('Hi {{1}}', blocks)['2']).toBe('')
  })
})

describe('rejectionHints', () => {
  it('returns the validation errors when any rule breaks', () => {
    const hints = rejectionHints('{{1}} bad start here friend', null)
    expect(hints.some(h => /cannot start with a variable/.test(h))).toBe(true)
  })
  it('explains a UTILITY rejection when the template is otherwise valid', () => {
    const body = 'Hello {{1}}, your order has shipped and arrives tomorrow afternoon.'
    const hints = rejectionHints(body, null, 'UTILITY')
    expect(hints).toEqual([
      'Utility templates must be about one order or account; promotional wording is rejected — submit it as Marketing.',
    ])
  })
  it('gives the generic review guidance otherwise', () => {
    const body = 'Hello {{1}}, your order has shipped and arrives tomorrow afternoon.'
    const hints = rejectionHints(body, null, 'MARKETING')
    expect(hints[0]).toMatch(/Make the text specific and plain/)
    expect(rejectionHints(body, null, null)[0]).toMatch(/Make the text specific and plain/)
  })
})

describe('brand constants', () => {
  it('exports the brand token name and sample', () => {
    expect(BRAND_VAR).toBe('brand_name')
    expect(BRAND_SAMPLE).toBe('Jeffi Stores')
  })
})
