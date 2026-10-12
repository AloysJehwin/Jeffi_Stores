// Provider-agnostic messaging seam. The only provider-specific operations in the whole SMS/WhatsApp
// stack are: send a plain-text message, and send a WhatsApp approved-template message. Everything else
// (phone normalization, the Site Controls channel gate, audit logging, the public send wrappers) is
// shared and lives in sms.ts / whatsapp.ts. A provider throws on failure and returns the provider's
// message id (sid) on success — callers already treat a throw as "not sent".

export interface SmsProvider {
  /** True when the provider has usable credentials; a false means "treat as not sent" without throwing. */
  readonly configured: boolean
  /** The sender number used (for the audit log). */
  readonly from: string
  /** Send a plain SMS to an E.164 number. Returns the provider message id. Throws on failure. */
  sendText(toE164: string, body: string): Promise<string>
}

export interface WhatsAppProvider {
  readonly configured: boolean
  /** The WhatsApp sender number (bare E.164, without the `whatsapp:` prefix) for the audit log. */
  readonly from: string
  /** Send an approved template. `templateRef` is the provider's template identifier (Twilio contentSid).
   *  `vars` is the numbered-slot variable map (media header is already folded in as a numbered slot). */
  sendTemplate(toE164: string, templateRef: string, vars: Record<string, string>): Promise<string>
  /** Free-text message (only valid inside the 24h customer-service window). */
  sendText(toE164: string, body: string): Promise<string>
}

export type ProviderName = 'twilio' | 'aws'
