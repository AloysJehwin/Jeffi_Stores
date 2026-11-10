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
import type { SenderOverride } from './senders.js'

// AWS End User Messaging, ported from the app's lib/shared/messaging/aws-provider.ts: WhatsApp through
// Social Messaging (the Cloud API JSON is passed through to Meta), SMS through SMS-Voice v2. Same call
// shapes as twilio.ts. Env is read per call; a missing id means not configured. A store's own AWS account
// (tenant_messaging_senders) comes in as `ov` and replaces every env value, including the credentials.

const env = (ov?: SenderOverride) => ov
  ? {
      region: ov.config.region || process.env.AWS_MESSAGING_REGION || process.env.AWS_REGION || 'us-east-1',
      waPhoneId: ov.config.whatsapp_phone_number_id || '',
      wabaId: ov.config.waba_id || '',
      metaApiVersion: process.env.AWS_WHATSAPP_META_API_VERSION || 'v20.0',
      smsOrigination: ov.config.sms_origination || ov.sender,
      configurationSet: ov.config.configuration_set || '',
      dltEntityId: ov.config.dlt_entity_id || '',
    }
  : {
      region: process.env.AWS_MESSAGING_REGION || process.env.AWS_REGION || 'us-east-1',
      waPhoneId: process.env.AWS_WHATSAPP_PHONE_NUMBER_ID || '',
      wabaId: process.env.AWS_WHATSAPP_WABA_ID || '',
      metaApiVersion: process.env.AWS_WHATSAPP_META_API_VERSION || 'v20.0',
      smsOrigination: process.env.AWS_SMS_ORIGINATION || '',
      configurationSet: process.env.AWS_SMS_CONFIGURATION_SET || '',
      dltEntityId: process.env.AWS_SMS_DLT_ENTITY_ID || '',
    }
const credentials = (ov?: SenderOverride) =>
  ov
    ? { accessKeyId: ov.config.access_key_id, secretAccessKey: ov.config.secret_access_key }
    : process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
      : undefined
// Per-store clients are kept by account + region so a tenant's sends reuse one connection pool.
const ovKey = (ov: SenderOverride) => `${env(ov).region}:${ov.config.access_key_id}`

export const awsSmsConfigured = () => !!env().smsOrigination
export const awsWhatsAppConfigured = () => !!env().waPhoneId
/** Template create/sync needs the AWS id of the linked WhatsApp Business Account (waba-…). */
export const awsTemplatesConfigured = () => !!env().wabaId

const notConfigured = (v: string) => new Error(`AWS messaging is not configured (${v})`)

let social: SocialMessagingClient | null = null
const socials = new Map<string, SocialMessagingClient>()
function socialClient(ov?: SenderOverride) {
  if (!ov) return (social ??= new SocialMessagingClient({ region: env().region, credentials: credentials() }))
  const k = ovKey(ov)
  let c = socials.get(k)
  if (!c) socials.set(k, (c = new SocialMessagingClient({ region: env(ov).region, credentials: credentials(ov) })))
  return c
}
// Loaded on first use so a missing SMS SDK can only fail AWS SMS sends, never the service.
let sms: PinpointSMSVoiceV2Client | null = null
const smss = new Map<string, PinpointSMSVoiceV2Client>()
async function sendText(input: SendTextMessageRequest, ov?: SenderOverride) {
  const m = await import('@aws-sdk/client-pinpoint-sms-voice-v2')
  let c: PinpointSMSVoiceV2Client
  if (!ov) c = sms ??= new m.PinpointSMSVoiceV2Client({ region: env().region, credentials: credentials() })
  else {
    const k = ovKey(ov)
    c = smss.get(k) ?? new m.PinpointSMSVoiceV2Client({ region: env(ov).region, credentials: credentials(ov) })
    smss.set(k, c)
  }
  return c.send(new m.SendTextMessageCommand(input))
}

async function sendCloud(message: object, ov?: SenderOverride): Promise<string> {
  const { waPhoneId, metaApiVersion } = env(ov)
  if (!waPhoneId) throw notConfigured('AWS_WHATSAPP_PHONE_NUMBER_ID')
  const r = await socialClient(ov).send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: waPhoneId,
      metaApiVersion,
      message: new TextEncoder().encode(JSON.stringify(message)),
    })
  )
  if (!r.messageId) throw new Error('AWS WhatsApp returned no message id')
  return r.messageId
}

export async function sendSms(o: { to: string; body: string; messageId: string }, ov?: SenderOverride): Promise<string> {
  const { smsOrigination, configurationSet, dltEntityId } = env(ov)
  if (!smsOrigination) throw notConfigured('AWS_SMS_ORIGINATION')
  const r = await sendText({
    DestinationPhoneNumber: normalizePhone(o.to),
    OriginationIdentity: smsOrigination,
    MessageBody: o.body,
    MessageType: 'TRANSACTIONAL',
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
    ...(dltEntityId ? { DestinationCountryParameters: { IN_ENTITY_ID: dltEntityId } } : {}),
  }, ov)
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
}, ov?: SenderOverride): Promise<string> {
  if (!env(ov).waPhoneId) throw notConfigured('AWS_WHATSAPP_PHONE_NUMBER_ID')
  const to = normalizePhone(o.to)
  if (!o.contentSid) return sendCloud(cloudText(to, o.body ?? ''), ov)
  if (!isAwsTemplateRef(o.contentSid)) throw new Error(`This WhatsApp template is not approved on AWS yet (${o.contentSid})`)
  const ref = parseAwsTemplateRef(o.contentSid)
  const vars = { ...(o.variables ?? {}) }
  // Twilio fills {{n}} inside the header URL; Meta takes the whole link.
  if (ref.header && o.headerUrl) {
    const v = vars[ref.header.slot]
    vars[ref.header.slot] = v && /^https?:\/\//.test(v) ? v : o.headerUrl.replace(PH, v ?? '')
  }
  return sendCloud(cloudTemplate(to, ref, vars), ov)
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
