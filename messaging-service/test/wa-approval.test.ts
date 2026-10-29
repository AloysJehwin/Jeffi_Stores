import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db.js', () => ({ db: {} }))
vi.mock('../src/pools.js', () => ({ poolsForTenant: vi.fn() }))
vi.mock('../src/providers/policy.js', () => ({ messagingProvider: vi.fn(async () => 'aws') }))
vi.mock('../src/templates-v2.js', async orig => ({ ...(await orig<any>()), findById: vi.fn(), setApprovalStatus: vi.fn() }))
const { awsSend } = vi.hoisted(() => ({ awsSend: vi.fn() }))
vi.mock('@aws-sdk/client-socialmessaging', async orig => ({
  ...(await orig<any>()),
  SocialMessagingClient: class { send = awsSend },
  CreateWhatsAppMessageTemplateCommand: class { constructor(public input: any) {} },
  ListWhatsAppMessageTemplatesCommand: class { constructor(public input: any) {} },
}))

const { composeTypes, validateForMeta, samplesFor, metaName, renumberForSubmit, awsTemplate, submit, syncTenant } = await import('../src/wa-approval')
const tpl = await import('../src/templates-v2')

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

  it('builds the AWS template and a ref whose slots send back through cloudTemplate', async () => {
    const { planSlots, parseAwsTemplateRef, cloudTemplate } = await import('@jeffi/api-contracts')
    const body = 'Hi {{1}}, your order {{2}} ships — from {{brand_name}} team.'
    const blocks = {
      types: { 'twilio/media': { media: ['https://cdn.jeffi/{{1}}'] } },
      buttons: [{ type: 'url' as const, label: 'Track', value: 'https://jeffi/t/{{1}}' }],
      variables: { 1: 'order-123.png' },
    }
    const { definition, ref } = awsTemplate('testco_order_v3', 'en', 'UTILITY', planSlots(body, blocks, { 1: 'Priya', 2: 'JS-10234' }), 'handle-1')
    expect(ref).toBe('aws:testco_order_v3:en|h=4:image|b=5@0')
    expect(definition.components).toEqual([
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['handle-1'] } },
      { type: 'BODY', text: 'Hi {{1}}, your order {{2}} ships — from {{3}} team.', example: { body_text: [['Priya', 'JS-10234', 'Jeffi Stores']] } },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track', url: 'https://jeffi/t/{{1}}', example: ['https://jeffi/t/order-123.png'] }] },
    ])
    const msg = cloudTemplate('+919999999999', parseAwsTemplateRef(ref), { 1: 'Ann', 2: 'JS-1', 3: 'Acme', 4: 'https://cdn.jeffi/x.png', 5: 'abc' })
    expect(msg.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.jeffi/x.png' } }] },
      { type: 'body', parameters: ['Ann', 'JS-1', 'Acme'].map(text => ({ type: 'text', text })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
    ])
    // provider_ref is varchar(80): a long name is cut, keeping the version.
    const long = awsTemplate(`${'x'.repeat(90)}_v12`, 'en', 'UTILITY', planSlots('Hello there.', {}))
    expect(long.ref.length).toBeLessThanOrEqual(80)
    expect(long.name).toMatch(/^x+_v12$/)
  })

  it('submits to AWS for a tenant on AWS and promotes the ref once Meta approves', async () => {
    process.env.AWS_WHATSAPP_WABA_ID = 'waba-1'
    try {
      vi.mocked(tpl.findById).mockResolvedValue({
        family: { slug: 'order/confirmed' }, template: { channel: 'whatsapp' },
        variant: { id: 'v1', locale: 'en', approval_status: 'draft', meta_category: null },
        version: { id: 'ver1', body: 'Your order {{1}} is confirmed. Thank you for shopping with us.', blocks: {}, version: 3, provider_ref: null },
      } as any)
      const pool = { query: vi.fn(async (sql: string) => ({ rows: sql.includes('FROM template_variant v') ? [{ id: 'v1', sid: 'aws:testco_order_confirmed_v3:en' }] : [] })) }
      awsSend.mockResolvedValueOnce({ metaTemplateId: '991', templateStatus: 'PENDING', category: 'UTILITY' })
      const r = await submit(pool as any, 't1', 'testco', 'tpl1')
      expect(r).toEqual({ sid: 'aws:testco_order_confirmed_v3:en', name: 'testco_order_confirmed_v3', status: 'pending' })
      const create = awsSend.mock.calls[0][0].input
      expect(create.id).toBe('waba-1')
      expect(JSON.parse(new TextDecoder().decode(create.templateDefinition))).toMatchObject({ name: 'testco_order_confirmed_v3', language: 'en', category: 'UTILITY' })
      expect(pool.query.mock.calls[0]).toEqual(['UPDATE template_version SET provider_ref=$2 WHERE id=$1', ['ver1', 'aws:testco_order_confirmed_v3:en']])

      awsSend.mockResolvedValueOnce({ templates: [{ templateName: 'testco_order_confirmed_v3', templateLanguage: 'en', templateStatus: 'APPROVED' }] })
      expect(await syncTenant(pool as any, 't1')).toEqual({ checked: 1, changed: 1 })
      expect(awsSend.mock.calls[1][0].input).toMatchObject({ id: 'waba-1' })
      expect(vi.mocked(tpl.setApprovalStatus).mock.calls[0][2]).toMatchObject({ status: 'approved', raw: 'APPROVED' })
      expect(pool.query.mock.calls.at(-1)).toEqual(['UPDATE template_variant SET provider_ref=$2 WHERE id=$1', ['v1', 'aws:testco_order_confirmed_v3:en']])
    } finally {
      delete process.env.AWS_WHATSAPP_WABA_ID
    }
  })
})
