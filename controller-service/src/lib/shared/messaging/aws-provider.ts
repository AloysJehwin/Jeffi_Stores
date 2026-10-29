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

// AWS End User Messaging: WhatsApp through Social Messaging (the Cloud API JSON is passed through to
// Meta), SMS through SMS-Voice v2. Configured only when the linked phone number id / SMS origination
// identity are set; until then `configured` is false and callers treat sends as not sent. Status and
// inbound events arrive through SNS at /api/webhooks/aws-messaging.

const REGION = process.env.AWS_MESSAGING_REGION || process.env.AWS_REGION || 'us-east-1'
const WA_PHONE_ID = process.env.AWS_WHATSAPP_PHONE_NUMBER_ID || ''
const META_API_VERSION = process.env.AWS_WHATSAPP_META_API_VERSION || 'v20.0'
const SMS_ORIGINATION = process.env.AWS_SMS_ORIGINATION || ''
// Inbound media is exported from Meta into this bucket, read once, then deleted.
const MEDIA_BUCKET = process.env.AWS_WHATSAPP_MEDIA_BUCKET || process.env.VAULT_S3_BUCKET || ''
const MAX_INBOUND_MEDIA = 25 * 1024 * 1024

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined

let social: SocialMessagingClient | null = null
let sms: PinpointSMSVoiceV2Client | null = null
let s3: S3Client | null = null
const socialClient = () => (social ??= new SocialMessagingClient({ region: REGION, credentials }))
const smsClient = () => (sms ??= new PinpointSMSVoiceV2Client({ region: REGION, credentials }))
const s3Client = () => (s3 ??= new S3Client({ region: process.env.AWS_REGION || REGION, credentials }))

async function sendCloud(message: object): Promise<string> {
  if (!WA_PHONE_ID) throw new Error('AWS WhatsApp is not configured (AWS_WHATSAPP_PHONE_NUMBER_ID)')
  const r = await socialClient().send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: WA_PHONE_ID,
      metaApiVersion: META_API_VERSION,
      message: new TextEncoder().encode(JSON.stringify(message)),
    })
  )
  if (!r.messageId) throw new Error('AWS WhatsApp returned no message id')
  return r.messageId
}

export const awsSmsProvider: SmsProvider = {
  get configured() {
    return !!SMS_ORIGINATION
  },
  name: 'aws',
  from: process.env.AWS_SMS_FROM || SMS_ORIGINATION,
  async sendText(toE164, body) {
    if (!SMS_ORIGINATION) throw new Error('AWS SMS is not configured (AWS_SMS_ORIGINATION)')
    const r = await smsClient().send(
      new SendTextMessageCommand({
        DestinationPhoneNumber: toE164,
        OriginationIdentity: SMS_ORIGINATION,
        MessageBody: body,
        MessageType: 'TRANSACTIONAL',
        ...(process.env.AWS_SMS_CONFIGURATION_SET ? { ConfigurationSetName: process.env.AWS_SMS_CONFIGURATION_SET } : {}),
        ...(process.env.AWS_SMS_DLT_ENTITY_ID
          ? { DestinationCountryParameters: { IN_ENTITY_ID: process.env.AWS_SMS_DLT_ENTITY_ID } }
          : {}),
      })
    )
    if (!r.MessageId) throw new Error('AWS SMS returned no message id')
    return r.MessageId
  },
}

export const awsWhatsAppProvider: WhatsAppProvider = {
  get configured() {
    return !!WA_PHONE_ID
  },
  name: 'aws',
  from: process.env.AWS_WHATSAPP_FROM || '',
  async sendTemplate(toE164, templateRef, vars) {
    if (!isAwsTemplateRef(templateRef)) throw new Error(`not an AWS template ref: ${templateRef}`)
    return sendCloud(cloudTemplate(toE164, parseAwsTemplateRef(templateRef), vars))
  },
  async sendText(toE164, body) {
    return sendCloud(cloudText(toE164, body))
  },
  // Prefer uploading from our private bucket (no public URL needed); fall back to a link.
  async sendMedia(toE164, media) {
    let id: string | undefined
    if (media.s3) {
      const r = await socialClient().send(
        new PostWhatsAppMessageMediaCommand({
          originationPhoneNumberId: WA_PHONE_ID,
          sourceS3File: { bucketName: media.s3.bucket, key: media.s3.key },
        })
      )
      id = r.mediaId
    }
    if (!id && !/^https:\/\//.test(media.url)) throw new Error('AWS media needs an S3 object or a public https URL')
    return sendCloud(cloudMedia(toE164, media.kind, id ? { id } : { link: media.url }, { caption: media.caption, filename: media.filename }))
  },
  async markRead(providerMessageId) {
    if (!WA_PHONE_ID || !providerMessageId.startsWith('wamid.')) return
    await sendCloud(cloudRead(providerMessageId))
  },
  async downloadMedia(mediaId) {
    if (!WA_PHONE_ID || !MEDIA_BUCKET) throw new Error('AWS WhatsApp media download is not configured')
    const prefix = `vault-staging/wa-inbound/${randomUUID()}/`
    const meta = await socialClient().send(
      new GetWhatsAppMessageMediaCommand({
        mediaId,
        originationPhoneNumberId: WA_PHONE_ID,
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
