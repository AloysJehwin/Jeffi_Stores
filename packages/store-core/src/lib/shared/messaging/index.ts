import { getProviderPolicy } from '@/lib/providers/policy'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantSender, type MessagingChannel, type TenantSender } from '@/lib/messaging/tenant-senders'
import type { ProviderName, SmsProvider, WhatsAppProvider } from './types'
import { twilioSmsProvider, twilioWhatsAppProvider, twilioSmsProviderFor, twilioWhatsAppProviderFor } from './twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider, awsSmsProviderFor, awsWhatsAppProviderFor } from './aws-provider'

// Pick the SMS/WhatsApp provider for the current store. A store with its own sender (control-plane
// tenant_messaging_senders) sends from that number with its own credentials, and the row's provider wins.
// Otherwise the platform provider policy (lib/providers/policy.ts; set on the flagship Site Controls) decides;
// with no policy row the store's old Site Controls choice still applies. Any resolver failure falls back to
// Twilio — except a sender row that can't be decrypted, which leaves the channel unconfigured rather than
// quietly sending from the platform number.

async function ownSender(channel: MessagingChannel): Promise<TenantSender | null | 'broken'> {
  const tid = await resolveTenantId().catch(() => null)
  if (!tid) return null
  try {
    return await getTenantSender(tid, channel)
  } catch (e) {
    console.warn(`[messaging] ${channel} sender unavailable: ${(e as Error)?.message}`)
    return 'broken'
  }
}

const unavailable = (name: ProviderName, why: string): SmsProvider & WhatsAppProvider => {
  const fail = async (): Promise<never> => { throw new Error(why) }
  return { configured: false, name, from: '', sendText: fail, sendTemplate: fail, sendMedia: fail, markRead: async () => {}, downloadMedia: fail }
}

export async function getSmsProvider(): Promise<SmsProvider> {
  const own = await ownSender('sms')
  if (own === 'broken') return unavailable('twilio', 'SMS sender credentials unavailable')
  if (own) return own.provider === 'aws' ? awsSmsProviderFor(own) : twilioSmsProviderFor(own)
  try {
    return (await getProviderPolicy()).smsProvider === 'aws' ? awsSmsProvider : twilioSmsProvider
  } catch {
    return twilioSmsProvider
  }
}

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  const own = await ownSender('whatsapp')
  if (own === 'broken') return unavailable('twilio', 'WhatsApp sender credentials unavailable')
  if (own) return own.provider === 'aws' ? awsWhatsAppProviderFor(own) : twilioWhatsAppProviderFor(own)
  try {
    return (await getProviderPolicy()).whatsappProvider === 'aws' ? awsWhatsAppProvider : twilioWhatsAppProvider
  } catch {
    return twilioWhatsAppProvider
  }
}

/** Whether each platform provider can actually send (AWS stays unavailable until onboarding completes). */
export function messagingProviderReadiness(): Record<'sms' | 'whatsapp', Record<'twilio' | 'aws', boolean>> {
  return {
    sms: { twilio: twilioSmsProvider.configured, aws: awsSmsProvider.configured },
    whatsapp: { twilio: twilioWhatsAppProvider.configured, aws: awsWhatsAppProvider.configured },
  }
}

export type { SmsProvider, WhatsAppProvider, ProviderName } from './types'
