import { vi, describe, it, expect, beforeEach } from 'vitest'

const getProviderPolicy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/providers/policy', () => ({ getProviderPolicy }))

import { getSmsProvider, getWhatsAppProvider, messagingProviderReadiness } from '@/lib/shared/messaging'
import { twilioSmsProvider, twilioWhatsAppProvider } from '@/lib/shared/messaging/twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider } from '@/lib/shared/messaging/aws-provider'

beforeEach(() => vi.clearAllMocks())

describe('messaging provider selector', () => {
  it('returns the Twilio provider when the policy is twilio', async () => {
    getProviderPolicy.mockResolvedValue({ smsProvider: 'twilio', whatsappProvider: 'twilio' })
    expect(await getSmsProvider()).toBe(twilioSmsProvider)
    expect(await getWhatsAppProvider()).toBe(twilioWhatsAppProvider)
  })

  it('returns the AWS provider when the policy is aws', async () => {
    getProviderPolicy.mockResolvedValue({ smsProvider: 'aws', whatsappProvider: 'aws' })
    expect(await getSmsProvider()).toBe(awsSmsProvider)
    expect(await getWhatsAppProvider()).toBe(awsWhatsAppProvider)
  })

  it('picks per channel and reads the current store policy', async () => {
    getProviderPolicy.mockResolvedValue({ smsProvider: 'aws', whatsappProvider: 'twilio' })
    expect(await getSmsProvider()).toBe(awsSmsProvider)
    expect(await getWhatsAppProvider()).toBe(twilioWhatsAppProvider)
    expect(getProviderPolicy).toHaveBeenCalledWith()
  })

  it('falls back to Twilio when the policy resolver throws', async () => {
    getProviderPolicy.mockRejectedValue(new Error('down'))
    expect(await getSmsProvider()).toBe(twilioSmsProvider)
    expect(await getWhatsAppProvider()).toBe(twilioWhatsAppProvider)
  })

  it('the AWS stub is not configured, reports not ready, and throws on send', async () => {
    expect(awsSmsProvider.configured).toBe(false)
    expect(messagingProviderReadiness().sms.aws).toBe(false)
    expect(messagingProviderReadiness().whatsapp.aws).toBe(false)
    await expect(awsSmsProvider.sendText('+919999999999', 'hi')).rejects.toThrow()
    await expect(awsWhatsAppProvider.sendTemplate('+919999999999', 'HX1', {})).rejects.toThrow()
  })
})
