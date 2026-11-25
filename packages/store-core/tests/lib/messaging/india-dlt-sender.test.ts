import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { query, getSmsDltConfig, send, ctor, getProviderPolicy } = vi.hoisted(() => ({
  query: vi.fn(), getSmsDltConfig: vi.fn(), send: vi.fn(), ctor: vi.fn(), getProviderPolicy: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/providers/sms-dlt', () => ({ getSmsDltConfig }))
vi.mock('@/lib/providers/policy', () => ({ getProviderPolicy }))
vi.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: class { send = send; constructor(cfg: any) { ctor(cfg) } },
  SendTextMessageCommand: class { constructor(public input: any) {} },
  DescribeSenderIdsCommand: class { constructor(public input: any) {} },
}))

import { saveTenantSender, invalidateTenantSenders, maskSenderConfig } from '@/lib/messaging/tenant-senders'
import { SenderPutSchema, FlagshipSenderPutSchema } from '@/lib/messaging/sender-schema'
import { indiaDltError, isIndiaDltConfig } from '@/lib/messaging/dlt-sender'
import { checkSenderId } from '@/lib/messaging/dlt-sender-check'
import { awsSmsProviderFor, usesPlatformCredentials } from '@/lib/shared/messaging/aws-provider'

const T = '11111111-1111-1111-1111-111111111111'
const platformCfg = { credentials: 'platform' }
const dltConfig = (senderIds: string[]) => ({ entityId: '1001412319353682317', senderIds, source: { entityId: 'platform', senderIds: 'platform' } })

describe('India DLT sender form validation', () => {
  it('accepts a platform header, or an own header with an entity id', () => {
    expect(indiaDltError('JEFFIS', {}, ['JEFFIS'])).toBeNull()
    expect(indiaDltError('jeffis', {}, ['JEFFIS'])).toBeNull()
    expect(indiaDltError('MYSHOP', { dlt_entity_id: '1001412319353682317' }, ['JEFFIS'])).toBeNull()
  })

  it('rejects an unregistered shared header, a bad header and a bad entity id', () => {
    expect(indiaDltError('MYSHOP', {}, ['JEFFIS'])).toMatch(/registered headers/)
    expect(indiaDltError('NO', {}, ['NO'])).toMatch(/3 to 11/)
    expect(indiaDltError('MY SHOP', {}, [])).toMatch(/3 to 11/)
    expect(indiaDltError('MYSHOP', { dlt_entity_id: '12ab' }, [])).toMatch(/entity ID/)
  })

  it('schema: platform credentials carry no keys, and the region can only be ap-south-1', () => {
    const ok = SenderPutSchema.safeParse({ provider: 'aws', sender: 'JEFFIS', config: platformCfg })
    expect(ok.success).toBe(true)
    expect(SenderPutSchema.safeParse({ provider: 'aws', sender: 'JEFFIS', config: { ...platformCfg, region: 'us-east-1' } }).success).toBe(false)
    expect(SenderPutSchema.safeParse({ provider: 'aws', sender: 'JEFFIS', config: { ...platformCfg, access_key_id: 'AK' } }).success).toBe(false)
    expect(SenderPutSchema.safeParse({ provider: 'aws', sender: 'MY SHOP', config: platformCfg }).success).toBe(false)
    expect(SenderPutSchema.safeParse({ provider: 'aws', sender: 'MYSHOP', config: { ...platformCfg, dlt_entity_id: 'abc' } }).success).toBe(false)
    expect(FlagshipSenderPutSchema.safeParse({ provider: 'aws', sender: 'JEFFIS', config: platformCfg }).success).toBe(true)
    // the keyed AWS form still needs its keys
    expect(SenderPutSchema.safeParse({ provider: 'aws', sender: '+91x', config: { region: 'ap-south-1' } }).success).toBe(false)
  })

  it('marker helpers', () => {
    expect(isIndiaDltConfig(platformCfg)).toBe(true)
    expect(isIndiaDltConfig({ access_key_id: 'a' })).toBe(false)
    expect(maskSenderConfig({ ...platformCfg, region: 'ap-south-1' })).toEqual({ credentials: 'platform', region: 'ap-south-1' })
  })
})

describe('saveTenantSender: India DLT', () => {
  beforeEach(() => {
    process.env.SOCIAL_TOKEN_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    query.mockReset()
    getSmsDltConfig.mockReset().mockResolvedValue(dltConfig(['JEFFIS']))
    invalidateTenantSenders()
  })
  afterEach(() => { delete process.env.SOCIAL_TOKEN_ENC_KEY })

  it('saves a shared platform header with the region forced to ap-south-1 and no keys', async () => {
    query.mockResolvedValueOnce({ rows: [{ created_by: 'a', created_at: new Date(), updated_at: new Date() }] })
    const saved = await saveTenantSender({ tenantId: T, channel: 'sms', provider: 'aws', sender: 'JEFFIS', config: platformCfg, createdBy: 'a' })
    expect(saved.meta).toEqual({ credentials: 'platform', region: 'ap-south-1' })
    // no uniqueness lookup for a shared header: one INSERT only
    expect(query).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(query.mock.calls[0][1])).not.toMatch(/AKIA|secret_access_key/)
  })

  it('saves an own header with its own entity id', async () => {
    query.mockResolvedValueOnce({ rows: [{ created_by: 'a', created_at: new Date(), updated_at: new Date() }] })
    const saved = await saveTenantSender({ tenantId: T, channel: 'sms', provider: 'aws', sender: 'MYSHOP', config: { ...platformCfg, dlt_entity_id: '1001000000000000001' } })
    expect(saved.meta).toMatchObject({ dlt_entity_id: '1001000000000000001', region: 'ap-south-1' })
  })

  it('rejects a header the platform has not registered, without writing', async () => {
    await expect(saveTenantSender({ tenantId: T, channel: 'sms', provider: 'aws', sender: 'MYSHOP', config: platformCfg })).rejects.toThrow(/registered headers/)
    expect(query).not.toHaveBeenCalled()
  })

  it('is SMS only and takes no AWS keys', async () => {
    await expect(saveTenantSender({ tenantId: T, channel: 'whatsapp', provider: 'aws', sender: 'JEFFIS', config: platformCfg })).rejects.toThrow(/only for India SMS/)
    await expect(saveTenantSender({ tenantId: T, channel: 'sms', provider: 'aws', sender: 'JEFFIS', config: { ...platformCfg, access_key_id: 'AK' } })).rejects.toThrow(/Do not enter AWS keys/)
    expect(query).not.toHaveBeenCalled()
  })
})

describe('checkSenderId', () => {
  beforeEach(() => { send.mockReset(); ctor.mockReset(); process.env.AWS_ACCESS_KEY_ID = 'AKIAPLATFORM'; process.env.AWS_SECRET_ACCESS_KEY = 's' })
  afterEach(() => { delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY })

  it('asks AWS in ap-south-1 with the platform credentials and reports Registered', async () => {
    send.mockResolvedValue({ SenderIds: [{ SenderId: 'JEFFIS', MessageTypes: ['TRANSACTIONAL'] }] })
    expect(await checkSenderId('JEFFIS')).toEqual({ header: 'JEFFIS', registered: true, status: 'TRANSACTIONAL' })
    expect(ctor).toHaveBeenCalledWith({ region: 'ap-south-1', credentials: { accessKeyId: 'AKIAPLATFORM', secretAccessKey: 's' } })
    expect(send.mock.calls[0][0].input).toEqual({ SenderIds: [{ SenderId: 'JEFFIS', IsoCountryCode: 'IN' }] })
  })

  it('reports Not registered on a not-found answer or an empty list, and rethrows other errors', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'ResourceNotFoundException' }))
    expect(await checkSenderId('JEFFIS')).toEqual({ header: 'JEFFIS', registered: false, status: null })
    send.mockResolvedValueOnce({ SenderIds: [] })
    expect((await checkSenderId('JEFFIS')).registered).toBe(false)
    send.mockRejectedValueOnce(new Error('AccessDenied'))
    await expect(checkSenderId('JEFFIS')).rejects.toThrow('AccessDenied')
    await expect(checkSenderId('bad header')).rejects.toThrow(/letters or digits/)
  })
})

describe('store-core AWS SMS provider with the platform account', () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ MessageId: 'm1' })
    ctor.mockReset()
    getProviderPolicy.mockResolvedValue({ smsDltEntityId: 'PE1' })
  })
  const ov: any = { sender: 'JEFFIS', config: { credentials: 'platform', region: 'ap-south-1' } }

  it('sends from ap-south-1 under the header with the DLT ids, storing no keys', async () => {
    expect(usesPlatformCredentials(ov)).toBe(true)
    await awsSmsProviderFor(ov).sendText('+919876543210', 'hi', { dltTemplateId: 'T1', dltHeader: 'OTHER' })
    expect(ctor.mock.calls[0][0].region).toBe('ap-south-1')
    expect(send.mock.calls[0][0].input).toMatchObject({ OriginationIdentity: 'JEFFIS', DestinationCountryParameters: { IN_ENTITY_ID: 'PE1', IN_TEMPLATE_ID: 'T1' } })
  })

  it('refuses a non-Indian number', async () => {
    await expect(awsSmsProviderFor(ov).sendText('+14155550123', 'hi')).rejects.toThrow(/\+91/)
    expect(send).not.toHaveBeenCalled()
  })
})
