import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { socialSend, smsSend } = vi.hoisted(() => ({ socialSend: vi.fn(), smsSend: vi.fn() }))
vi.mock('@aws-sdk/client-socialmessaging', () => ({
  SocialMessagingClient: class { send = socialSend },
  SendWhatsAppMessageCommand: class { constructor(public input: any) {} },
  CreateWhatsAppMessageTemplateCommand: class { constructor(public input: any) {} },
  CreateWhatsAppMessageTemplateMediaCommand: class { constructor(public input: any) {} },
  ListWhatsAppMessageTemplatesCommand: class { constructor(public input: any) {} },
}))
vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class { send = smsSend },
  SendTextMessageCommand: class { constructor(public input: any) {} },
}))

import * as aws from '../src/providers/aws'

const WA = 'AWS_WHATSAPP_PHONE_NUMBER_ID'
const WABA = 'AWS_WHATSAPP_WABA_ID'
const SMS = 'AWS_SMS_ORIGINATION'

describe('aws provider configured flags', () => {
  afterEach(() => { for (const k of [WA, WABA, SMS]) delete process.env[k] })
  it('read the env per call', () => {
    expect(aws.awsSmsConfigured()).toBe(false)
    process.env[SMS] = 'sender-1'; expect(aws.awsSmsConfigured()).toBe(true)
    process.env[WA] = 'pid'; expect(aws.awsWhatsAppConfigured()).toBe(true)
    process.env[WABA] = 'waba'; expect(aws.awsTemplatesConfigured()).toBe(true)
  })
})

describe('aws sendSms', () => {
  beforeEach(() => { smsSend.mockReset() })
  afterEach(() => { for (const k of [SMS, 'AWS_SMS_CONFIGURATION_SET', 'AWS_SMS_DLT_ENTITY_ID']) delete process.env[k] })

  it('sends with config set + DLT entity and returns the message id', async () => {
    process.env[SMS] = 'sender-1'; process.env.AWS_SMS_CONFIGURATION_SET = 'cfg'; process.env.AWS_SMS_DLT_ENTITY_ID = 'dlt1'
    smsSend.mockResolvedValue({ MessageId: 'sms-1' })
    const id = await aws.sendSms({ to: '9876543210', body: 'hello', messageId: 'm1' })
    expect(id).toBe('sms-1')
    expect(smsSend.mock.calls[0][0].input).toMatchObject({
      DestinationPhoneNumber: '+919876543210', OriginationIdentity: 'sender-1',
      ConfigurationSetName: 'cfg', DestinationCountryParameters: { IN_ENTITY_ID: 'dlt1' },
    })
  })

  it('throws when SMS origination is not set, and when no id comes back', async () => {
    await expect(aws.sendSms({ to: '9', body: 'x', messageId: 'm' })).rejects.toThrow(/not configured/)
    process.env[SMS] = 'sender-1'
    smsSend.mockResolvedValue({})
    await expect(aws.sendSms({ to: '9', body: 'x', messageId: 'm' })).rejects.toThrow(/no message id/)
  })

  it("uses a store's own AWS override credentials/region", async () => {
    smsSend.mockResolvedValue({ MessageId: 'sms-ov' })
    await aws.sendSms({ to: '9876543210', body: 'hi', messageId: 'm' }, { sender: '+1999', config: { access_key_id: 'AK', secret_access_key: 'S', region: 'ap-south-1', sms_origination: 'OV' } })
    expect(smsSend.mock.calls[0][0].input.OriginationIdentity).toBe('OV')
  })
})

describe('aws sendWhatsApp', () => {
  beforeEach(() => { socialSend.mockReset() })
  afterEach(() => { for (const k of [WA, WABA]) delete process.env[k] })

  it('sends a plain text body (Cloud API) and returns the message id', async () => {
    process.env[WA] = 'pid'
    socialSend.mockResolvedValue({ messageId: 'wamid.1' })
    const id = await aws.sendWhatsApp({ to: '9876543210', body: 'hi', messageId: 'm1' })
    expect(id).toBe('wamid.1')
    const payload = JSON.parse(new TextDecoder().decode(socialSend.mock.calls[0][0].input.message))
    expect(payload).toMatchObject({ messaging_product: 'whatsapp', type: 'text' })
  })

  it('rejects a non-AWS content ref and throws without a phone id', async () => {
    process.env[WA] = 'pid'
    await expect(aws.sendWhatsApp({ to: '9', contentSid: 'HX_twilio', messageId: 'm' })).rejects.toThrow(/not approved on AWS/)
    delete process.env[WA]
    await expect(aws.sendWhatsApp({ to: '9', body: 'x', messageId: 'm' })).rejects.toThrow(/not configured/)
  })

  it('sends an aws: template ref, filling the header slot with the template URL', async () => {
    process.env[WA] = 'pid'
    socialSend.mockResolvedValue({ messageId: 'wamid.2' })
    await aws.sendWhatsApp({ to: '9876543210', contentSid: 'aws:order_v1:en|h=3:image', variables: { 1: 'A' }, headerUrl: 'https://cdn/{{3}}.png', messageId: 'm' })
    const payload = JSON.parse(new TextDecoder().decode(socialSend.mock.calls[0][0].input.message))
    expect(payload.type).toBe('template')
  })

  it('throws when the Cloud API returns no message id', async () => {
    process.env[WA] = 'pid'
    socialSend.mockResolvedValue({})
    await expect(aws.sendWhatsApp({ to: '9', body: 'x', messageId: 'm' })).rejects.toThrow(/no message id/)
  })
})

describe('aws template admin', () => {
  beforeEach(() => { socialSend.mockReset(); process.env[WABA] = 'waba-1' })
  afterEach(() => delete process.env[WABA])

  it('createTemplate submits the definition JSON', async () => {
    socialSend.mockResolvedValue({ metaTemplateId: '1', templateStatus: 'PENDING', category: 'UTILITY' })
    const r = await aws.createTemplate({ name: 'n' })
    expect(r).toEqual({ metaTemplateId: '1', status: 'PENDING', category: 'UTILITY' })
    expect(socialSend.mock.calls[0][0].input.id).toBe('waba-1')
  })

  it('templateMediaHandle returns the handle, throws without one', async () => {
    socialSend.mockResolvedValueOnce({ metaHeaderHandle: 'h1' })
    expect(await aws.templateMediaHandle('bucket', 'key')).toBe('h1')
    socialSend.mockResolvedValueOnce({})
    await expect(aws.templateMediaHandle('bucket', 'key')).rejects.toThrow(/no header handle/)
  })

  it('listTemplates pages through nextToken', async () => {
    socialSend
      .mockResolvedValueOnce({ templates: [{ templateName: 'a' }], nextToken: 'n2' })
      .mockResolvedValueOnce({ templates: [{ templateName: 'b' }] })
    expect((await aws.listTemplates()).map(t => t.templateName)).toEqual(['a', 'b'])
    expect(socialSend).toHaveBeenCalledTimes(2)
  })

  it('throws when the WABA id is missing', async () => {
    delete process.env[WABA]
    await expect(aws.listTemplates()).rejects.toThrow(/WABA_ID/)
  })
})
