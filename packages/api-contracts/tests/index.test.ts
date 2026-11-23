import { describe, it, expect } from 'vitest'
import {
  API_SCOPES,
  Channel,
  DocumentType,
  Slug,
  HostMediaRequest,
  SendMessageRequest,
  LineItem,
  DocumentDiscount,
  UpdateLibraryTemplateRequest,
  UpsertLibraryTemplateRequest,
  TemplateQuery,
  RenderDocumentRequest,
} from '../src/index'

describe('API_SCOPES catalog', () => {
  it('has the exact six scopes in order', () => {
    expect(API_SCOPES).toEqual([
      'messages:send', 'templates:read', 'templates:write', 'documents:render', 'documents:read', 'wallet:read',
    ])
  })
  it('is readonly-typed and deduped', () => {
    expect(new Set(API_SCOPES).size).toBe(API_SCOPES.length)
  })
})

describe('base enums / slug', () => {
  it('Channel + DocumentType accept their members and reject others', () => {
    expect(Channel.safeParse('whatsapp').success).toBe(true)
    expect(Channel.safeParse('pigeon').success).toBe(false)
    expect(DocumentType.safeParse('invoice').success).toBe(true)
    expect(DocumentType.safeParse('memo').success).toBe(false)
  })
  it('Slug enforces the lowercase pattern', () => {
    expect(Slug.safeParse('order-confirmed').success).toBe(true)
    expect(Slug.safeParse('Order').success).toBe(false) // uppercase
    expect(Slug.safeParse('x').success).toBe(false) // too short (min 2 chars total)
  })
})

describe('HostMediaRequest refine — url xor data', () => {
  it('accepts exactly one of url/data', () => {
    expect(HostMediaRequest.safeParse({ url: 'https://x/i.png' }).success).toBe(true)
    expect(HostMediaRequest.safeParse({ data: 'base64', content_type: 'image/png' }).success).toBe(true)
  })
  it('rejects both or neither', () => {
    expect(HostMediaRequest.safeParse({ url: 'https://x/i.png', data: 'b' }).success).toBe(false)
    expect(HostMediaRequest.safeParse({}).success).toBe(false)
  })
})

describe('SendMessageRequest refines', () => {
  it('requires template or body', () => {
    expect(SendMessageRequest.safeParse({ channel: 'email', to: 'a@b.com' }).success).toBe(false)
    expect(SendMessageRequest.safeParse({ channel: 'email', to: 'a@b.com', body: 'hi' }).success).toBe(true)
  })
  it('validates `to` as email for channel=email, phone otherwise', () => {
    expect(SendMessageRequest.safeParse({ channel: 'email', to: 'not-an-email', body: 'x' }).success).toBe(false)
    expect(SendMessageRequest.safeParse({ channel: 'sms', to: '+919876543210', body: 'x' }).success).toBe(true)
    expect(SendMessageRequest.safeParse({ channel: 'sms', to: 'a@b.com', body: 'x' }).success).toBe(false)
  })
})

describe('LineItem refines', () => {
  const base = { description: 'Widget', quantity: 2, unit_price: 100 }
  it('accepts a plain line', () => {
    expect(LineItem.safeParse(base).success).toBe(true)
  })
  it('rejects both discount and discount_pct', () => {
    expect(LineItem.safeParse({ ...base, discount: 10, discount_pct: 5 }).success).toBe(false)
  })
  it('rejects a discount larger than the line amount', () => {
    expect(LineItem.safeParse({ ...base, discount: 999 }).success).toBe(false) // 2*100 = 200
    expect(LineItem.safeParse({ ...base, discount: 50 }).success).toBe(true)
  })
})

describe('DocumentDiscount refine — amount xor percent', () => {
  it('accepts one', () => {
    expect(DocumentDiscount.safeParse({ amount: 50 }).success).toBe(true)
    expect(DocumentDiscount.safeParse({ percent: 10 }).success).toBe(true)
  })
  it('rejects both or neither', () => {
    expect(DocumentDiscount.safeParse({ amount: 50, percent: 10 }).success).toBe(false)
    expect(DocumentDiscount.safeParse({}).success).toBe(false)
  })
})

describe('library template schemas', () => {
  const valid = { slug: 'welcome', channel: 'whatsapp', name: 'Welcome', body: 'Hi there' }
  it('UpsertLibraryTemplateRequest defaults publish=true', () => {
    const r = UpsertLibraryTemplateRequest.parse(valid)
    expect(r.publish).toBe(true)
  })
  it('UpdateLibraryTemplateRequest drops slug/channel and makes name/body optional', () => {
    expect(UpdateLibraryTemplateRequest.safeParse({ note: 'tweak' }).success).toBe(true)
    // slug/channel are omitted from the shape, so supplying them is ignored, not required
    expect(UpdateLibraryTemplateRequest.safeParse({}).success).toBe(true)
  })
})

describe('TemplateQuery + RenderDocumentRequest defaults', () => {
  it('TemplateQuery coerces include_system and defaults it true', () => {
    expect(TemplateQuery.parse({}).include_system).toBe(true)
    // z.coerce.boolean: any non-empty string is truthy; only '' coerces to false.
    expect(TemplateQuery.parse({ include_system: '' }).include_system).toBe(false)
    expect(TemplateQuery.parse({ include_system: 'false' }).include_system).toBe(true)
  })
  it('RenderDocumentRequest requires at least one line item', () => {
    const seller = { name: 'S' }
    const buyer = { name: 'B' }
    const item = { description: 'X', quantity: 1, unit_price: 10 }
    expect(RenderDocumentRequest.safeParse({ seller, buyer, items: [] }).success).toBe(false)
    const ok = RenderDocumentRequest.parse({ seller, buyer, items: [item] })
    expect(ok.currency).toBe('INR')
    expect(ok.prices_include_gst).toBe(true)
  })
})
