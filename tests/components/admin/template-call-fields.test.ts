import { describe, it, expect } from 'vitest'
import { templateCallFields } from '@/components/admin/messaging-templates/template-call-fields'

describe('templateCallFields', () => {
  it('lists email/SMS variables, minus the ones the API fills', () => {
    const f = templateCallFields({ channel: 'email', subject: 'Order {{order_number}}', body: 'Hi {{customer_name}}, from {{store_name}} {coupon}' })
    expect(Object.keys(f.variables!)).toEqual(['order_number', 'customer_name', 'coupon'])
    expect(f.variables!.coupon).toBe('<coupon>')
    expect(f).toMatchObject({ mediaSlot: false, buttonSlot: false })
  })

  it('finds WhatsApp slots, the image and the link button', () => {
    const f = templateCallFields({
      channel: 'whatsapp', body: 'Hi {{2}}, order {{1}} shipped',
      blocks: { variables: { 1: 'JS-1' }, types: { 'twilio/media': { media: ['https://x/{{3}}'] } }, buttons: [{ type: 'url', value: 'https://x/{{4}}' }] },
    })
    expect(f).toEqual({ variables: { 1: 'JS-1', 2: 'value 2' }, mediaSlot: true, buttonSlot: true })
  })
})
