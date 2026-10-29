import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { simpleParser, type ParsedMail } from 'mailparser'
import { confirmSnsSubscription, verifySns, type SnsEnvelope } from '@/lib/shared/messaging/sns'
import { lookupTenantContextBySlug } from '@/lib/tenant-registry/host-resolution'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { parseReplyAddress } from '@/lib/replies/context'
import { topReply } from '@/lib/replies/email-text'
import { handleInboundEmail } from '@/lib/support/email-inbound'
import { onCustomerMessage } from '@/lib/support/agent'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// SES receiving for reply.<domain>: the rule stores each mail in S3 and announces it over SNS. The
// reply+<store>.<token> address picks the store and the question; the mail joins the customer's
// support chat and the reply engine reads it.

interface SesReceived {
  notificationType?: string
  mail?: { messageId?: string; destination?: string[] }
  receipt?: {
    recipients?: string[]
    spamVerdict?: { status?: string }
    virusVerdict?: { status?: string }
    spfVerdict?: { status?: string }
    dkimVerdict?: { status?: string }
    dmarcVerdict?: { status?: string }
    action?: { type?: string; bucketName?: string; objectKey?: string }
  }
}

let s3: S3Client | null = null
const client = () => (s3 ??= new S3Client({ region: process.env.SES_INBOUND_REGION || process.env.AWS_REGION || 'us-east-1' }))

export async function POST(request: NextRequest) {
  let env: SnsEnvelope
  try {
    env = JSON.parse(await request.text())
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!(await verifySns(env))) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  if (env.Type === 'SubscriptionConfirmation') {
    return (await confirmSnsSubscription(env)) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: 'confirm failed' }, { status: 502 })
  }
  if (env.Type !== 'Notification') return new NextResponse(null, { status: 204 })

  let n: SesReceived
  try {
    n = JSON.parse(env.Message)
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  const r = n.receipt
  if (n.notificationType !== 'Received' || r?.action?.type !== 'S3' || !r.action.bucketName || !r.action.objectKey || !n.mail?.messageId) {
    return new NextResponse(null, { status: 204 })
  }
  if (r.spamVerdict?.status === 'FAIL' || r.virusVerdict?.status === 'FAIL') return new NextResponse(null, { status: 204 })

  const addr = (r.recipients ?? n.mail.destination ?? []).map(parseReplyAddress).find(Boolean)
  if (!addr) return new NextResponse(null, { status: 204 })
  const ctx = addr.slug ? await lookupTenantContextBySlug(addr.slug).catch(() => null) : null
  if (addr.slug && !ctx) return new NextResponse(null, { status: 204 })

  try {
    const run = () => handle(n, addr.token)
    await (ctx ? runWithTenantContext(ctx, run) : run())
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[ses-inbound] mail failed', err instanceof Error ? err.message : err)
    // SNS retries on 5xx; the mail is handled once per SES message id.
    return NextResponse.json({ error: 'retry' }, { status: 503 })
  }
}

/** Out-of-office and other machine replies never act on anything. */
function automated(mail: ParsedMail): boolean {
  const h = (k: string) => String(mail.headers.get(k) ?? '').toLowerCase()
  const auto = h('auto-submitted')
  return (!!auto && auto !== 'no') || !!h('x-autoreply') || !!h('x-autorespond') || ['bulk', 'junk', 'list', 'auto_reply'].includes(h('precedence'))
}

async function handle(n: SesReceived, token: string): Promise<void> {
  const action = n.receipt!.action!
  const obj = await client().send(new GetObjectCommand({ Bucket: action.bucketName, Key: action.objectKey }))
  const raw = Buffer.from(await obj.Body!.transformToByteArray())
  const mail = await simpleParser(raw)
  const from = mail.from?.value?.[0]?.address?.trim()
  if (!from || automated(mail)) return

  const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])].filter((v): v is string => !!v)
  const pass = (v?: { status?: string }) => v?.status === 'PASS'
  // The From address is only believed when its domain vouches for it.
  const authenticated = pass(n.receipt!.dmarcVerdict) || (pass(n.receipt!.spfVerdict) && pass(n.receipt!.dkimVerdict))

  const got = await handleInboundEmail({
    sesId: n.mail!.messageId!,
    messageId: mail.messageId?.replace(/^<|>$/g, '') || null,
    from,
    fromName: mail.from?.value?.[0]?.name || null,
    subject: mail.subject ?? '',
    text: topReply(mail.text ?? ''),
    token,
    attachments: mail.attachments
      .filter(a => a.contentDisposition !== 'inline' || !a.contentId)
      .map(a => ({ filename: a.filename ?? null, contentType: a.contentType, content: a.content })),
  })
  if (!got) return
  await onCustomerMessage(got.session, got.message, { token, emailRefs: refs, email: from, verified: authenticated })
}
