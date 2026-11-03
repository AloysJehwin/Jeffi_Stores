import 'server-only'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { sendOTPWhatsApp } from '@/lib/shared/whatsapp'
import { sendOTPSMS } from '@/lib/shared/sms'
import { sendPhoneOTPEmail } from '@/lib/email'

export type PhoneOtpChannel = 'whatsapp' | 'sms' | 'email'

/**
 * A mobile-number verification code goes by WhatsApp; SMS when WhatsApp is off in Site Controls
 * (or can't send); email when neither can. Returns the channel used, or null when nothing went out.
 */
export async function deliverPhoneOtp(p: {
  phone: string
  otp: string
  email?: string | null
  name?: string | null
}): Promise<PhoneOtpChannel | null> {
  const flags = await getFeatureFlags()
  if (flags.whatsappEnabled && (await sendOTPWhatsApp({ phone: p.phone, otp: p.otp }))) return 'whatsapp'
  if (flags.smsEnabled && (await sendOTPSMS({ phone: p.phone, otp: p.otp }))) return 'sms'
  if (p.email && (await sendPhoneOTPEmail(p.email, p.otp, p.phone, p.name || undefined)).success) return 'email'
  return null
}
