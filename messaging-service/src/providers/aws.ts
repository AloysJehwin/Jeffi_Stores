import {
  SocialMessagingClient,
  SendWhatsAppMessageCommand,
  CreateWhatsAppMessageTemplateCommand,
  CreateWhatsAppMessageTemplateMediaCommand,
  ListWhatsAppMessageTemplatesCommand,
  type TemplateSummary,
} from '@aws-sdk/client-socialmessaging'
import type { PinpointSMSVoiceV2Client, SendTextMessageRequest } from '@aws-sdk/client-pinpoint-sms-voice-v2'
import { cloudTemplate, cloudText, isAwsTemplateRef, parseAwsTemplateRef } from '@jeffi/api-contracts'
import { normalizePhone } from './twilio.js'

// AWS End User Messaging, ported from the app's lib/shared/messaging/aws-provider.ts: WhatsApp through
// Social Messaging (the Cloud API JSON is passed through to Meta), SMS through SMS-Voice v2. Same call
// shapes as twilio.ts. Env is read per call; a missing id means not configured.

const env = () => ({
  region: process.env.AWS_MESSAGING_REGION || process.env.AWS_REGION || 'us-east-1',
  waPhoneId: process.env.AWS_WHATSAPP_PHONE_NUMBER_ID || '',
  wabaId: process.env.AWS_WHATSAPP_WABA_ID || '',
  metaApiVersion: process.env.AWS_WHATSAPP_META_API_VERSION || 'v20.0',
  smsOrigination: process.env.AWS_SMS_ORIGINATION || '',
})
const credentials = () =>
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined

export const awsSmsConfigured = () => !!env().smsOrigination
export const awsWhatsAppConfigured = () => !!env().waPhoneId
/** Template create/sync needs the AWS id of the linked WhatsApp Business Account (waba-…). */
export const awsTemplatesConfigured = () => !!env().wabaId

const notConfigured = (v: string) => new Error(`AWS messaging is not configured (${v})`)

let social: SocialMessagingClient | null = null
const socialClient = () => (social ??= new SocialMessagingClient({ region: env().region, credentials: credentials() }))
// Loaded on first use so a missing SMS SDK can only fail AWS SMS sends, never the service.
let sms: PinpointSMSVoiceV2Client | null = null
async function sendText(input: SendTextMessageRequest) {
  const m = await import('@aws-sdk/client-pinpoint-sms-voice-v2')
  sms ??= new m.PinpointSMSVoiceV2Client({ region: env().region, credentials: credentials() })
  return sms.send(new m.SendTextMessageCommand(input))
}

async function sendCloud(message: object): Promise<string> {
  const { waPhoneId, metaApiVersion } = env()
  if (!waPhoneId) throw notConfigured('AWS_WHATSAPP_PHONE_NUMBER_ID')
  const r = await socialClient().send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: waPhoneId,
      metaApiVersion,
      message: new TextEncoder().encode(JSON.stringify(message)),
    })
  )
  if (!r.messageId) throw new Error('AWS WhatsApp returned no message id')
  return r.messageId
}

export async function sendSms(o: { to: string; body: string; messageId: string }): Promise<string> {
  const { smsOrigination } = env()
  if (!smsOrigination) throw notConfigured('AWS_SMS_ORIGINATION')
  const r = await sendText({
    DestinationPhoneNumber: normalizePhone(o.to),
    OriginationIdentity: smsOrigination,
    MessageBody: o.body,
    MessageType: 'TRANSACTIONAL',
    ...(process.env.AWS_SMS_CONFIGURATION_SET ? { ConfigurationSetName: process.env.AWS_SMS_CONFIGURATION_SET } : {}),
    ...(process.env.AWS_SMS_DLT_ENTITY_ID ? { DestinationCountryParameters: { IN_ENTITY_ID: process.env.AWS_SMS_DLT_ENTITY_ID } } : {}),
  })
  if (!r.MessageId) throw new Error('AWS SMS returned no message id')
  return r.MessageId
}

const PH = /\{\{\s*\d+\s*\}\}/

/** contentSid is the template's `aws:<name>:<lang>` ref; headerUrl the template's header media URL. */
export async function sendWhatsApp(o: {
  to: string
  body?: string
  contentSid?: string
  variables?: Record<string, string>
  messageId: string
  headerUrl?: string
}): Promise<string> {
  if (!env().waPhoneId) throw notConfigured('AWS_WHATSAPP_PHONE_NUMBER_ID')
  const to = normalizePhone(o.to)
  if (!o.contentSid) return sendCloud(cloudText(to, o.body ?? ''))
  if (!isAwsTemplateRef(o.contentSid)) throw new Error(`This WhatsApp template is not approved on AWS yet (${o.contentSid})`)
  const ref = parseAwsTemplateRef(o.contentSid)
  const vars = { ...(o.variables ?? {}) }
  // Twilio fills {{n}} inside the header URL; Meta takes the whole link.
  if (ref.header && o.headerUrl) {
    const v = vars[ref.header.slot]
    vars[ref.header.slot] = v && /^https?:\/\//.test(v) ? v : o.headerUrl.replace(PH, v ?? '')
  }
  return sendCloud(cloudTemplate(to, ref, vars))
}

function wabaId() {
  const id = env().wabaId
  if (!id) throw notConfigured('AWS_WHATSAPP_WABA_ID')
  return id
}

/** Submits Meta's template definition JSON for review. */
export async function createTemplate(definition: object) {
  const r = await socialClient().send(
    new CreateWhatsAppMessageTemplateCommand({ id: wabaId(), templateDefinition: new TextEncoder().encode(JSON.stringify(definition)) })
  )
  return { metaTemplateId: r.metaTemplateId, status: r.templateStatus, category: r.category }
}

/** Uploads a header sample from S3 for Meta's review; returns the header handle. */
export async function templateMediaHandle(bucketName: string, key: string): Promise<string> {
  const r = await socialClient().send(new CreateWhatsAppMessageTemplateMediaCommand({ id: wabaId(), sourceS3File: { bucketName, key } }))
  if (!r.metaHeaderHandle) throw new Error('AWS returned no header handle')
  return r.metaHeaderHandle
}

/** Every template on the linked WhatsApp Business Account. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  const out: TemplateSummary[] = []
  let nextToken: string | undefined
  do {
    const r = await socialClient().send(new ListWhatsAppMessageTemplatesCommand({ id: wabaId(), nextToken, maxResults: 100 }))
    out.push(...(r.templates ?? []))
    nextToken = r.nextToken
  } while (nextToken)
  return out
}
