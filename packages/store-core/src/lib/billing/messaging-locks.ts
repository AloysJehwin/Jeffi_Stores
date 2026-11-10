// Why SMS / WhatsApp / app push is locked on a store (SiteControls.locks). Dependency-free so client code can import it.
export type MessagingLock = 'addon' | 'number'
export type PushLock = 'app'
export interface MessagingLocks {
  sms?: MessagingLock
  whatsapp?: MessagingLock
  push?: PushLock
}
export const MESSAGING_LOCK_HINT: Record<MessagingLock | PushLock, string> = {
  addon: 'Add SMS & WhatsApp in the ecom portal (Billing) to enable this.',
  number: 'Waiting for your number to be assigned by Jeffi.',
  app: "Add your store app's build ID above to turn this on.",
}
