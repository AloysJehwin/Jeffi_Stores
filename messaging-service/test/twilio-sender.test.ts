import { describe, it, expect, vi, beforeEach } from 'vitest'

const { factory, create } = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = 'ACplatform'
  process.env.TWILIO_AUTH_TOKEN = 'platform-token'
  process.env.TWILIO_FROM_NUMBER = '+10000000000'
  process.env.TWILIO_WHATSAPP_FROM = '+10000000001'
  const create = vi.fn(async () => ({ sid: 'SM1' }))
  return { create, factory: vi.fn(() => ({ messages: { create } })) }
})
vi.mock('twilio', () => ({ default: factory }))

import { sendSms, sendWhatsApp } from '../src/providers/twilio'

describe('twilio sender override', () => {
  beforeEach(() => { factory.mockClear(); create.mockClear() })

  it('uses the platform env without an override', async () => {
    await sendSms({ to: '9999999999', body: 'hi', messageId: 'm1' })
    expect(factory).toHaveBeenCalledWith('ACplatform', 'platform-token')
    expect(create.mock.calls[0][0]).toMatchObject({ from: '+10000000000', to: '+919999999999' })
  })

  it("builds a client from the store's own account and sends from its number", async () => {
    await sendWhatsApp({ to: '+919999999999', body: 'hi', messageId: 'm2' }, { sender: '+912200000000', config: { account_sid: 'ACtenant', auth_token: 'tenant-token' } })
    expect(factory).toHaveBeenCalledWith('ACtenant', 'tenant-token')
    expect(create.mock.calls[0][0]).toMatchObject({ from: 'whatsapp:+912200000000' })
  })

  it('prefers an API key pair and passes the messaging service SID', async () => {
    await sendSms({ to: '+919999999999', body: 'hi', messageId: 'm3' }, { sender: 'JEFFIS', config: { account_sid: 'ACtenant', api_key_sid: 'SK1', api_key_secret: 's3', messaging_service_sid: 'MG1' } })
    expect(factory).toHaveBeenCalledWith('SK1', 's3', { accountSid: 'ACtenant' })
    expect(create.mock.calls[0][0]).toMatchObject({ messagingServiceSid: 'MG1', from: 'JEFFIS' })
  })

  it("never falls back to the platform credentials when the store's are incomplete", async () => {
    await expect(sendSms({ to: '+919999999999', body: 'hi', messageId: 'm4' }, { sender: 'JEFFIS', config: { account_sid: 'ACtenant' } })).rejects.toThrow(/not configured/)
    expect(factory).not.toHaveBeenCalled()
  })
})
