import {
  SocialMessagingClient,
  SendWhatsAppMessageCommand,
  PostWhatsAppMessageMediaCommand,
  GetWhatsAppMessageMediaCommand,
} from '@aws-sdk/client-socialmessaging'
import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2'
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'
import {
  cloudMedia,
  cloudRead,
  cloudTemplate,
  cloudText,
  isAwsTemplateRef,
  parseAwsTemplateRef,
} from '@jeffi/api-contracts'
import type { SmsProvider, WhatsAppProvider } from './types'
import type { TenantSender } from '@/lib/messaging/tenant-senders'

// AWS End User Messaging: WhatsApp through Social Messaging (the Cloud API JSON is passed through to
// Meta), SMS through SMS-Voice v2. Configured only when the linked phone number id / SMS origination
// identity are set; until then `configured` is false and callers treat sends as not sent. Status and
// inbound events arrive through SNS at /api/webhooks/aws-messaging. A store with its own AWS account
// (tenant_messaging_senders) gets the same providers bound to its ids and keys through the *For factories.

const REGION = process.env.AWS_MESSAGING_REGION || process.env.AWS_REGION || 'us-east-1'
const WA_PHONE_ID = process.env.AWS_WHATSAPP_PHONE_NUMBER_ID || ''
const META_API_VERSION = process.env.AWS_WHATSAPP_META_API_VERSION || 'v20.0'
const SMS_ORIGINATION = process.env.AWS_SMS_ORIGINATION || ''
// Inbound media is exported from Meta into this bucket, read once, then deleted.
const MEDIA_BUCKET = process.env.AWS_WHATSAPP_MEDIA_BUCKET || process.env.VAULT_S3_BUCKET || ''
const MAX_INBOUND_MEDIA = 25 * 1024 * 1024

export type SenderOverride = Pick<TenantSender, 'sender' | 'config'>

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined

// Everything a send reads: the platform env, or the store's own account.
const cfg = (ov?: SenderOverride) =>
  ov
    ? {
        region: ov.config.region || REGION,
        waPhoneId: ov.config.whatsapp_phone_number_id || '',
        smsOrigination: ov.config.sms_origination || ov.sender,
        smsFrom: ov.sender,
        waFrom: ov.sender,
        configurationSet: ov.config.configuration_set || '',
        dltEntityId: ov.config.dlt_entity_id || '',
        credentials: { accessKeyId: ov.config.access_key_id, secretAccessKey: ov.config.secret_access_key },
      }
    : {
        region: REGION,
        waPhoneId: WA_PHONE_ID,
        smsOrigination: SMS_ORIGINATION,
        smsFrom: process.env.AWS_SMS_FROM || SMS_ORIGINATION,
        waFrom: process.env.AWS_WHATSAPP_FROM || '',
        configurationSet: process.env.AWS_SMS_CONFIGURATION_SET || '',
        dltEntityId: process.env.AWS_SMS_DLT_ENTITY_ID || '',
        credentials,
      }

let social: SocialMessagingClient | null = null
let sms: PinpointSMSVoiceV2Client | null = null
let s3: S3Client | null = null
// Per-store clients are kept by account + region so a store's sends reuse one connection pool.
const socials = new Map<string, SocialMessagingClient>()
const smss = new Map<string, PinpointSMSVoiceV2Client>()
const ovKey = (ov: SenderOverride) => `${cfg(ov).region}:${ov.config.access_key_id}`
function socialClient(ov?: SenderOverride) {
  if (!ov) return (social ??= new SocialMessagingClient({ region: REGION, credentials }))
  const k = ovKey(ov)
  let c = socials.get(k)
  if (!c) socials.set(k, (c = new SocialMessagingClient({ region: cfg(ov).region, credentials: cfg(ov).credentials })))
  return c
}
function smsClient(ov?: SenderOverride) {
  if (!ov) return (sms ??= new PinpointSMSVoiceV2Client({ region: REGION, credentials }))
  const k = ovKey(ov)
  let c = smss.get(k)
  if (!c) smss.set(k, (c = new PinpointSMSVoiceV2Client({ region: cfg(ov).region, credentials: cfg(ov).credentials })))
  return c
}
const s3Client = () => (s3 ??= new S3Client({ region: process.env.AWS_REGION || REGION, credentials }))

async function sendCloud(message: object, ov?: SenderOverride): Promise<string> {
  const { waPhoneId } = cfg(ov)
  if (!waPhoneId) throw new Error('AWS WhatsApp is not configured (AWS_WHATSAPP_PHONE_NUMBER_ID)')
  const r = await socialClient(ov).send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: waPhoneId,
      metaApiVersion: META_API_VERSION,
      message: new TextEncoder().encode(JSON.stringify(message)),
    })
  )
  if (!r.messageId) throw new Error('AWS WhatsApp returned no message id')
  return r.messageId
}

export function awsSmsProviderFor(ov?: SenderOverride): SmsProvider {
  const c = cfg(ov)
  return {
    get configured() {
      return !!c.smsOrigination
    },
    name: 'aws',
    from: c.smsFrom,
    async sendText(toE164, body) {
      if (!c.smsOrigination) throw new Error('AWS SMS is not configured (AWS_SMS_ORIGINATION)')
      const r = await smsClient(ov).send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: toE164,
          OriginationIdentity: c.smsOrigination,
          MessageBody: body,
          MessageType: 'TRANSACTIONAL',
          ...(c.configurationSet ? { ConfigurationSetName: c.configurationSet } : {}),
          ...(c.dltEntityId ? { DestinationCountryParameters: { IN_ENTITY_ID: c.dltEntityId } } : {}),
        })
      )
      if (!r.MessageId) throw new Error('AWS SMS returned no message id')
      return r.MessageId
    },
  }
}

export function awsWhatsAppProviderFor(ov?: SenderOverride): WhatsAppProvider {
  const c = cfg(ov)
  return {
    get configured() {
      return !!c.waPhoneId
    },
    name: 'aws',
    from: c.waFrom,
    async sendTemplate(toE164, templateRef, vars) {
      if (!isAwsTemplateRef(templateRef)) throw new Error(`not an AWS template ref: ${templateRef}`)
      return sendCloud(cloudTemplate(toE164, parseAwsTemplateRef(templateRef), vars), ov)
    },
    async sendText(toE164, body) {
      return sendCloud(cloudText(toE164, body), ov)
    },
    // Prefer uploading from our private bucket (no public URL needed); fall back to a link.
    async sendMedia(toE164, media) {
      let id: string | undefined
      if (media.s3) {
        const r = await socialClient(ov).send(
          new PostWhatsAppMessageMediaCommand({
            originationPhoneNumberId: c.waPhoneId,
            sourceS3File: { bucketName: media.s3.bucket, key: media.s3.key },
          })
        )
        id = r.mediaId
      }
      if (!id && !/^https:\/\//.test(media.url)) throw new Error('AWS media needs an S3 object or a public https URL')
      return sendCloud(cloudMedia(toE164, media.kind, id ? { id } : { link: media.url }, { caption: media.caption, filename: media.filename }), ov)
    },
    async markRead(providerMessageId) {
      if (!c.waPhoneId || !providerMessageId.startsWith('wamid.')) return
      await sendCloud(cloudRead(providerMessageId), ov)
    },
    async downloadMedia(mediaId) {
      if (!c.waPhoneId || !MEDIA_BUCKET) throw new Error('AWS WhatsApp media download is not configured')
      const prefix = `vault-staging/wa-inbound/${randomUUID()}/`
      const meta = await socialClient(ov).send(
        new GetWhatsAppMessageMediaCommand({
          mediaId,
          originationPhoneNumberId: c.waPhoneId,
          destinationS3File: { bucketName: MEDIA_BUCKET, key: prefix },
        })
      )
      if ((meta.fileSize ?? 0) > MAX_INBOUND_MEDIA) throw new Error('media too large')
      // The object lands at <prefix><mediaId>[.<ext>]; list-free lookup tries the bare id first.
      const key = `${prefix}${mediaId}`
      const obj = await s3Client().send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }))
      const bytes = Buffer.from(await obj.Body!.transformToByteArray())
      await s3Client().send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key })).catch(() => {})
      return { bytes, mime: meta.mimeType || obj.ContentType || 'application/octet-stream' }
    },
  }
}

export const awsSmsProvider: SmsProvider = awsSmsProviderFor()
export const awsWhatsAppProvider: WhatsAppProvider = awsWhatsAppProviderFor()
