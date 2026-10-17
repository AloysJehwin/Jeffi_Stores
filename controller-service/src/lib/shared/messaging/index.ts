import { getProviderPolicy } from '@/lib/providers/policy'
import type { SmsProvider, WhatsAppProvider } from './types'
import { twilioSmsProvider, twilioWhatsAppProvider } from './twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider } from './aws-provider'

// Pick the SMS/WhatsApp provider for the current store from the platform provider policy
// (lib/providers/policy.ts; set on the flagship Site Controls). With no policy row the store's old
// Site Controls choice still applies. Any resolver failure falls back to Twilio.

export async function getSmsProvider(): Promise<SmsProvider> {
  try {
    return (await getProviderPolicy()).smsProvider === 'aws' ? awsSmsProvider : twilioSmsProvider
  } catch {
    return twilioSmsProvider
  }
}

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  try {
    return (await getProviderPolicy()).whatsappProvider === 'aws' ? awsWhatsAppProvider : twilioWhatsAppProvider
  } catch {
    return twilioWhatsAppProvider
  }
}

/** Whether each provider can actually send (AWS stays unavailable until onboarding completes). */
export function messagingProviderReadiness(): Record<'sms' | 'whatsapp', Record<'twilio' | 'aws', boolean>> {
  return {
    sms: { twilio: twilioSmsProvider.configured, aws: awsSmsProvider.configured },
    whatsapp: { twilio: twilioWhatsAppProvider.configured, aws: awsWhatsAppProvider.configured },
  }
}

export type { SmsProvider, WhatsAppProvider, ProviderName } from './types'
