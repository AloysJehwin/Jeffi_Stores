// Who a store's numbers serve and on which channels. No server imports: client components read it too.

export type MessagingChannel = 'sms' | 'whatsapp'
export type SenderAudience = 'customer' | 'admin' | 'ecom'

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'

export const isSenderAudience = (v: unknown): v is SenderAudience => v === 'customer' || v === 'admin' || v === 'ecom'

/** The audiences a tenant can have: the flagship also has the ecom portal's number. */
export const audiencesFor = (tenantId: string): SenderAudience[] =>
  tenantId === PLATFORM_TENANT_ID ? ['customer', 'admin', 'ecom'] : ['customer', 'admin']

/** The channels each audience has its own number on. Staff are reached on WhatsApp only: an SMS to staff (a sign-in
 *  code) goes out from the customer SMS sender, the DLT header, which names the store, not an audience. */
export const AUDIENCE_CHANNELS: Record<SenderAudience, MessagingChannel[]> = {
  customer: ['whatsapp', 'sms'],
  admin: ['whatsapp'],
  ecom: ['whatsapp', 'sms'],
}
