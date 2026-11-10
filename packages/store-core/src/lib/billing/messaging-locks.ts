// Why SMS / WhatsApp is locked on a tenant store (SiteControls.locks). Dependency-free so client code can import it.
export type MessagingLock = 'addon' | 'number'
export interface MessagingLocks {
  sms?: MessagingLock
  whatsapp?: MessagingLock
}
export const MESSAGING_LOCK_HINT: Record<MessagingLock, string> = {
  addon: 'Add SMS & WhatsApp in the ecom portal (Billing) to enable this.',
  number: 'Waiting for your number to be assigned by Jeffi.',
}
