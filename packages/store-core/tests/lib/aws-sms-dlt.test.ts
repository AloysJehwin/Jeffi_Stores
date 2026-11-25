import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { send, getProviderPolicy } = vi.hoisted(() => ({ send: vi.fn(), getProviderPolicy: vi.fn() }))
vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class { send = send },
  SendTextMessageCommand: class { constructor(public input: any) {} },
}))
vi.mock('@/lib/providers/policy', () => ({ getProviderPolicy }))

import { awsSmsProviderFor, dltEntityId } from '@/lib/shared/messaging/aws-provider'

const ov = (dlt?: string): any => ({
  sender: 'HDR', audience: 'customer', provider: 'aws',
  config: { access_key_id: 'AK', secret_access_key: 'S', region: 'ap-south-1', sms_origination: 'OV', ...(dlt ? { dlt_entity_id: dlt } : {}) },
})
const params = () => send.mock.calls.at(-1)![0].input.DestinationCountryParameters

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue({ MessageId: 'm1' })
  getProviderPolicy.mockResolvedValue({})
})
afterEach(() => { delete process.env.AWS_SMS_DLT_ENTITY_ID })

describe('AWS SMS India DLT params', () => {
  it('sends entity and template ids to an Indian number', async () => {
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'PE1' })
    await awsSmsProviderFor(ov()).sendText('+919876543210', 'hi', { dltTemplateId: 'T1', templateSlug: 'a/b' })
    expect(params()).toEqual({ IN_ENTITY_ID: 'PE1', IN_TEMPLATE_ID: 'T1' })
  })

  it('without a template id still sends, warning once with the slug and no number', async () => {
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'PE1' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await awsSmsProviderFor(ov()).sendText('+919876543210', 'hi', { templateSlug: 'order/shipped' })
    expect(params()).toEqual({ IN_ENTITY_ID: 'PE1' })
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(JSON.parse(line)).toMatchObject({ msg: 'sms_dlt_template_id_missing', template_slug: 'order/shipped' })
    expect(line).not.toContain('9876543210')
    warn.mockRestore()
  })

  it('uses the DLT header and message type for India, and the default origination elsewhere', async () => {
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'PE1' })
    await awsSmsProviderFor(ov()).sendText('+919876543210', 'hi', { dltTemplateId: 'T1', dltHeader: 'JEFFIS', messageType: 'PROMOTIONAL' })
    expect(send.mock.calls[0][0].input).toMatchObject({ OriginationIdentity: 'JEFFIS', MessageType: 'PROMOTIONAL' })
    await awsSmsProviderFor(ov()).sendText('+14155550123', 'hi', { dltHeader: 'JEFFIS' })
    expect(send.mock.calls[1][0].input).toMatchObject({ OriginationIdentity: 'OV', MessageType: 'TRANSACTIONAL' })
  })

  it('sends no India params to a non-Indian number', async () => {
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'PE1' })
    await awsSmsProviderFor(ov()).sendText('+14155550123', 'hi', { dltTemplateId: 'T1' })
    expect(send.mock.calls[0][0].input).not.toHaveProperty('DestinationCountryParameters')
  })
})

describe('DLT entity id resolution order', () => {
  it('sender config, then provider setting, then env', async () => {
    process.env.AWS_SMS_DLT_ENTITY_ID = 'ENV'
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'SETTING' })
    expect(await dltEntityId('SENDER')).toBe('SENDER')
    expect(await dltEntityId('')).toBe('SETTING')
    getProviderPolicy.mockResolvedValue({})
    expect(await dltEntityId('')).toBe('ENV')
    getProviderPolicy.mockRejectedValue(new Error('down'))
    expect(await dltEntityId('')).toBe('ENV')
    delete process.env.AWS_SMS_DLT_ENTITY_ID
    expect(await dltEntityId('')).toBe('')
  })

  it('applies the order through a send', async () => {
    process.env.AWS_SMS_DLT_ENTITY_ID = 'ENV'
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'SETTING' })
    await awsSmsProviderFor(ov('SENDER')).sendText('+919876543210', 'hi', { dltTemplateId: 'T' })
    expect(params().IN_ENTITY_ID).toBe('SENDER')
    await awsSmsProviderFor(ov()).sendText('+919876543210', 'hi', { dltTemplateId: 'T' })
    expect(params().IN_ENTITY_ID).toBe('SETTING')
  })
})
