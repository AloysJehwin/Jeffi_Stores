// Provider-agnostic messaging seam. The only provider-specific operations in the whole SMS/WhatsApp
// stack are: send a plain-text message, and send a WhatsApp approved-template message. Everything else
// (phone normalization, the Site Controls channel gate, audit logging, the public send wrappers) is
// shared and lives in sms.ts / whatsapp.ts. A provider throws on failure and returns the provider's
// message id (sid) on success — callers already treat a throw as "not sent".

export interface SmsProvider {
  /** True when the provider has usable credentials; a false means "treat as not sent" without throwing. */
  readonly configured: boolean
  /** Which provider this is (for the audit log / spend attribution). */
  readonly name: ProviderName
  /** The sender number used (for the audit log). */
  readonly from: string
  /** Send a plain SMS to an E.164 number. Returns the provider message id. Throws on failure. */
  sendText(toE164: string, body: string): Promise<string>
}

export interface WhatsAppProvider {
  readonly configured: boolean
  /** Which provider this is (for the audit log / spend attribution). */
  readonly name: ProviderName
  /** The WhatsApp sender number (bare E.164, without the `whatsapp:` prefix) for the audit log. */
  readonly from: string
  /** Send an approved template. `templateRef` is the provider's template identifier (Twilio contentSid).
   *  `vars` is the numbered-slot variable map (media header is already folded in as a numbered slot). */
  sendTemplate(toE164: string, templateRef: string, vars: Record<string, string>): Promise<string>
  /** Free-text message (only valid inside the 24h customer-service window). */
  sendText(toE164: string, body: string): Promise<string>
  /** Free-form media (image/video/audio/document) inside the 24h window; `caption` rides along. */
  sendMedia(toE164: string, media: OutboundMedia): Promise<string>
  /** Blue ticks on the customer's message, where the provider supports it. */
  markRead(providerMessageId: string): Promise<void>
  /** Bytes of an inbound media item: a Twilio MediaUrl or an AWS/Meta media id. */
  downloadMedia(ref: string): Promise<{ bytes: Buffer; mime: string }>
}

export interface OutboundMedia {
  kind: 'image' | 'video' | 'audio' | 'document'
  mime: string
  filename?: string
  caption?: string
  /** Short-lived URL the provider fetches (Twilio, or AWS when no S3 object is available). */
  url: string
  /** The object in our private bucket (AWS uploads straight from S3). */
  s3?: { bucket: string; key: string }
}

export type ProviderName = 'twilio' | 'aws'
