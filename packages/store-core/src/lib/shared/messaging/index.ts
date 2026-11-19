import { getProviderPolicy } from '@/lib/providers/policy'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getTenantSender, PLATFORM_TENANT_ID, type MessagingChannel, type SenderAudience, type TenantSender } from '@/lib/messaging/tenant-senders'
import type { ProviderName, SmsProvider, WhatsAppProvider } from './types'
import { twilioSmsProvider, twilioWhatsAppProvider, twilioSmsProviderFor, twilioWhatsAppProviderFor } from './twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider, awsSmsProviderFor, awsWhatsAppProviderFor } from './aws-provider'

// Pick the SMS/WhatsApp provider for the current store. A store with its own sender (control-plane
// tenant_messaging_senders) sends from that number with its own credentials, and the row's provider wins.
// The flagship (no tenant) has its rows under PLATFORM_TENANT_ID; without one, the platform provider policy
// (lib/providers/policy.ts; set on the flagship Site Controls) picks the platform env's account, with Twilio on any
// resolver failure. A store without a number of its own can't send: the platform env's numbers are the flagship's.
// A sender row that can't be decrypted also leaves the channel unconfigured.

async function ownSender(channel: MessagingChannel, audience: SenderAudience): Promise<TenantSender | 'platform' | 'none' | 'broken'> {
  let tid: string
  try {
    tid = (await resolveTenantId()) ?? PLATFORM_TENANT_ID
  } catch {
    return 'platform'
  }
  try {
    return (await getTenantSender(tid, channel, audience)) ?? (tid === PLATFORM_TENANT_ID ? 'platform' : 'none')
  } catch (e) {
    console.warn(`[messaging] ${channel} sender unavailable: ${(e as Error)?.message}`)
    return 'broken'
  }
}

const unavailable = (name: ProviderName, why: string): SmsProvider & WhatsAppProvider => {
  const fail = async (): Promise<never> => { throw new Error(why) }
  return { configured: false, name, from: '', sendText: fail, sendTemplate: fail, sendMedia: fail, markRead: async () => {}, downloadMedia: fail }
}

/** `audience` picks which of the store's numbers sends: customer (default), admin (staff) or ecom (flagship owner portal). */
export async function getSmsProvider(audience: SenderAudience = 'customer'): Promise<SmsProvider> {
  const own = await ownSender('sms', audience)
  if (own === 'broken') return unavailable('twilio', 'SMS sender credentials unavailable')
  if (own === 'none') return unavailable('twilio', 'This store has no SMS number yet')
  if (own !== 'platform') return own.provider === 'aws' ? awsSmsProviderFor(own) : twilioSmsProviderFor(own)
  try {
    return (await getProviderPolicy()).smsProvider === 'aws' ? awsSmsProvider : twilioSmsProvider
  } catch {
    return twilioSmsProvider
  }
}

export async function getWhatsAppProvider(audience: SenderAudience = 'customer'): Promise<WhatsAppProvider> {
  const own = await ownSender('whatsapp', audience)
  if (own === 'broken') return unavailable('twilio', 'WhatsApp sender credentials unavailable')
  if (own === 'none') return unavailable('twilio', 'This store has no WhatsApp number yet')
  if (own !== 'platform') return own.provider === 'aws' ? awsWhatsAppProviderFor(own) : twilioWhatsAppProviderFor(own)
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
