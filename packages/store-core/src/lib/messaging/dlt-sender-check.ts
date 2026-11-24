import { PinpointSMSVoiceV2Client, DescribeSenderIdsCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2'
import { DLT_HEADER_RE, IN_DLT_REGION } from '@/lib/messaging/dlt-sender'

// Read-only: is this header a sender ID on the platform's AWS account in ap-south-1? Nothing is requested or
// registered. The platform env credentials are used and never returned.

export interface SenderIdCheck {
  header: string
  registered: boolean
  /** The message types AWS lists for the sender ID when it exists. */
  status: string | null
}

export async function checkSenderId(header: string): Promise<SenderIdCheck> {
  const h = header.trim()
  if (!DLT_HEADER_RE.test(h)) throw new Error('The DLT header is 3 to 11 letters or digits')
  const client = new PinpointSMSVoiceV2Client({
    region: IN_DLT_REGION,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
        : undefined,
  })
  try {
    const r = await client.send(new DescribeSenderIdsCommand({ SenderIds: [{ SenderId: h, IsoCountryCode: 'IN' }] }))
    const hit = r.SenderIds?.find(s => s.SenderId?.toLowerCase() === h.toLowerCase())
    return { header: h, registered: !!hit, status: hit ? (hit.MessageTypes?.join(', ') || 'REGISTERED') : null }
  } catch (e: any) {
    if (e?.name === 'ResourceNotFoundException') return { header: h, registered: false, status: null }
    throw e
  }
}
