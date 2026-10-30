import 'server-only'
import { createVerify } from 'crypto'

// Amazon SNS HTTPS deliveries: signature check against the AWS-hosted signing cert, and the
// subscription handshake. https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

export interface SnsEnvelope {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | string
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  Signature: string
  SignatureVersion: string
  SigningCertURL: string
  Subject?: string
  SubscribeURL?: string
  Token?: string
}

const CERT_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/
const SUBSCRIBE_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\//
const certs = new Map<string, string>()

function stringToSign(m: SnsEnvelope): string {
  const keys =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  let out = ''
  for (const k of keys) {
    const v = (m as unknown as Record<string, string | undefined>)[k]
    if (v !== undefined) out += `${k}\n${v}\n`
  }
  return out
}

/** Signed by SNS, from an allowed topic (AWS_MESSAGING_SNS_TOPIC_ARNS, comma-separated, when set). */
export async function verifySns(m: SnsEnvelope): Promise<boolean> {
  if (!m?.Signature || !m.SigningCertURL || !CERT_URL.test(m.SigningCertURL)) return false
  const allowed = (process.env.AWS_MESSAGING_SNS_TOPIC_ARNS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length && !allowed.includes(m.TopicArn)) return false
  let cert = certs.get(m.SigningCertURL)
  if (!cert) {
    const res = await fetch(m.SigningCertURL, { redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null)
    if (!res?.ok) return false
    cert = await res.text()
    certs.set(m.SigningCertURL, cert)
  }
  try {
    return createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(stringToSign(m), 'utf8').verify(cert, m.Signature, 'base64')
  } catch {
    return false
  }
}

/** Accept a subscription to our endpoint (only for an SNS-hosted confirm link). */
export async function confirmSnsSubscription(m: SnsEnvelope): Promise<boolean> {
  if (!m.SubscribeURL || !SUBSCRIBE_URL.test(m.SubscribeURL)) return false
  const res = await fetch(m.SubscribeURL, { redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null)
  return !!res?.ok
}
