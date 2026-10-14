import { getFeatureFlags } from '@/lib/catalog/site-controls'
import type { SmsProvider, WhatsAppProvider } from './types'
import { twilioSmsProvider, twilioWhatsAppProvider } from './twilio-provider'
import { awsSmsProvider, awsWhatsAppProvider } from './aws-provider'

// Pick the SMS/WhatsApp provider for the current tenant from the Site Controls selector
// (feature_sms_provider / feature_whatsapp_provider → flags.smsProvider / .whatsappProvider).
// Defaults to Twilio; getFeatureFlags never throws, but the catch keeps provider resolution
// self-contained so a resolver hiccup falls back to Twilio rather than erroring.

export async function getSmsProvider(): Promise<SmsProvider> {
  try {
    return (await getFeatureFlags()).smsProvider === 'aws' ? awsSmsProvider : twilioSmsProvider
  } catch {
    return twilioSmsProvider
  }
}

export async function getWhatsAppProvider(): Promise<WhatsAppProvider> {
  try {
    return (await getFeatureFlags()).whatsappProvider === 'aws' ? awsWhatsAppProvider : twilioWhatsAppProvider
  } catch {
    return twilioWhatsAppProvider
  }
}

export type { SmsProvider, WhatsAppProvider, ProviderName } from './types'
