import { vi, describe, it, expect, beforeEach } from 'vitest'

const getFeatureFlags = vi.hoisted(() => vi.fn())
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags }))

import { getSmsProvider, getWhatsAppProvider } from '@/lib/shared/messaging'
import { twilioSmsProvider, twilioWhatsAppProvider } from '@/lib/shared/messaging/twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider } from '@/lib/shared/messaging/aws-provider'

beforeEach(() => vi.clearAllMocks())

describe('messaging provider selector', () => {
  it('returns the Twilio provider when the flag is twilio', async () => {
    getFeatureFlags.mockResolvedValue({ smsProvider: 'twilio', whatsappProvider: 'twilio' })
    expect(await getSmsProvider()).toBe(twilioSmsProvider)
    expect(await getWhatsAppProvider()).toBe(twilioWhatsAppProvider)
  })

  it('returns the AWS provider when the flag is aws', async () => {
    getFeatureFlags.mockResolvedValue({ smsProvider: 'aws', whatsappProvider: 'aws' })
    expect(await getSmsProvider()).toBe(awsSmsProvider)
    expect(await getWhatsAppProvider()).toBe(awsWhatsAppProvider)
  })

  it('falls back to Twilio when the flags resolver throws', async () => {
    getFeatureFlags.mockRejectedValue(new Error('down'))
    expect(await getSmsProvider()).toBe(twilioSmsProvider)
    expect(await getWhatsAppProvider()).toBe(twilioWhatsAppProvider)
  })

  it('the AWS stub is not configured and throws on send', async () => {
    expect(awsSmsProvider.configured).toBe(false)
    await expect(awsSmsProvider.sendText('+919999999999', 'hi')).rejects.toThrow()
    await expect(awsWhatsAppProvider.sendTemplate('+919999999999', 'HX1', {})).rejects.toThrow()
  })
})
