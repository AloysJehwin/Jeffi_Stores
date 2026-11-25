import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { smsSend, ctor } = vi.hoisted(() => ({ smsSend: vi.fn(), ctor: vi.fn() }))
vi.mock('@aws-sdk/client-socialmessaging', () => ({
  SocialMessagingClient: class { send = vi.fn() },
  SendWhatsAppMessageCommand: class { constructor(public input: any) {} },
  CreateWhatsAppMessageTemplateCommand: class { constructor(public input: any) {} },
  CreateWhatsAppMessageTemplateMediaCommand: class { constructor(public input: any) {} },
  ListWhatsAppMessageTemplatesCommand: class { constructor(public input: any) {} },
}))
vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class { send = smsSend; constructor(cfg: any) { ctor(cfg) } },
  SendTextMessageCommand: class { constructor(public input: any) {} },
}))
vi.mock('../src/providers/policy', () => ({ smsDltEntityId: vi.fn(async () => 'PE-PLATFORM') }))

import * as aws from '../src/providers/aws'

const ov = { sender: 'JEFFIS', config: { credentials: 'platform', region: 'ap-south-1' } }
const KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_MESSAGING_REGION', 'AWS_REGION']

describe('India DLT sender on the platform AWS account', () => {
  beforeEach(() => {
    smsSend.mockReset().mockResolvedValue({ MessageId: 'in-1' })
    ctor.mockReset()
    process.env.AWS_ACCESS_KEY_ID = 'AKIAPLATFORM'
    process.env.AWS_SECRET_ACCESS_KEY = 'platform-secret'
    process.env.AWS_MESSAGING_REGION = 'us-east-1'
  })
  afterEach(() => { for (const k of KEYS) delete process.env[k] })

  it('sends with the platform env credentials from ap-south-1, the header and the DLT ids', async () => {
    const id = await aws.sendSms({ to: '9876543210', body: 'hi', messageId: 'm', dltTemplateId: 'T1' }, ov)
    expect(id).toBe('in-1')
    expect(ctor).toHaveBeenCalledWith({ region: 'ap-south-1', credentials: { accessKeyId: 'AKIAPLATFORM', secretAccessKey: 'platform-secret' } })
    expect(smsSend.mock.calls[0][0].input).toMatchObject({
      DestinationPhoneNumber: '+919876543210',
      OriginationIdentity: 'JEFFIS',
      DestinationCountryParameters: { IN_ENTITY_ID: 'PE-PLATFORM', IN_TEMPLATE_ID: 'T1' },
    })
  })

  it("prefers the store's own entity id and keeps the sender header over the template's", async () => {
    await aws.sendSms({ to: '9876543210', body: 'hi', messageId: 'm', dltTemplateId: 'T1', dltHeader: 'OTHER' }, { sender: 'MYSHOP', config: { ...ov.config, dlt_entity_id: '1001000000000000001' } })
    expect(smsSend.mock.calls[0][0].input).toMatchObject({ OriginationIdentity: 'MYSHOP', DestinationCountryParameters: { IN_ENTITY_ID: '1001000000000000001', IN_TEMPLATE_ID: 'T1' } })
  })

  it('refuses a non-Indian number', async () => {
    await expect(aws.sendSms({ to: '+14155550123', body: 'hi', messageId: 'm' }, ov)).rejects.toThrow(/\+91/)
    expect(smsSend).not.toHaveBeenCalled()
  })

  it('never sends a promotional SMS on a service header: no promotional header means nothing is sent', async () => {
    await expect(aws.sendSms({ to: '9876543210', body: 'hi', messageId: 'm', messageType: 'PROMOTIONAL' }, ov)).rejects.toBeInstanceOf(aws.PromoHeaderMissingError)
    expect(smsSend).not.toHaveBeenCalled()
  })

  it('sends a promotional SMS only from its own promotional header, and a non-Indian one unchanged', async () => {
    await aws.sendSms({ to: '9876543210', body: 'hi', messageId: 'm', messageType: 'PROMOTIONAL', dltHeader: '600123', dltTemplateId: 'T2' }, ov)
    expect(smsSend.mock.calls[0][0].input).toMatchObject({ OriginationIdentity: '600123', MessageType: 'PROMOTIONAL' })
  })

  it('recognises the platform-credentials marker', () => {
    expect(aws.usesPlatformCredentials(ov)).toBe(true)
    expect(aws.usesPlatformCredentials({ sender: 'x', config: { access_key_id: 'a' } })).toBe(false)
    expect(aws.usesPlatformCredentials(undefined)).toBe(false)
  })
})
