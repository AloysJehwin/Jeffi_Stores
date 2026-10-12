import nodemailer from 'nodemailer'
import { queryOne } from '@/lib/shared/db'
import { findTokenKeys } from '@/lib/templates/variables-shared'
import { messagingGateAllows, debitEmailCost } from '@/lib/shared/messaging/billing'

// Single chokepoint for outbound mail. Wraps transporter.sendMail and writes
// a row to email_logs (status, body, kind, entity link) so admins can see
// every mail in /admin/audit?tab=mail_log including the rendered HTML body.
//
// Failures still surface — we re-throw after logging so existing try/catch in
// callers continues to work. If the audit insert itself fails, we swallow it
// so a logging glitch never blocks the actual mail.

export interface SendAuditedMailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  amp?: string
  from?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  attachments?: any[]
  headers?: Record<string, string>
  // Audit metadata — describe what kind of mail this is so the audit log can
  // group/filter and link back to the source entity (order, rfq, invoice...).
  kind: string
  entityType?: string | null
  entityId?: string | null
  userId?: string | null
  templateName?: string | null
  metadata?: Record<string, unknown> | null
  // When true the body (html + text) is not written to email_logs. Use for
  // sensitive mails like OTP where storing the body would be a security risk.
  redactBody?: boolean
}

async function resolveDefaultFrom(): Promise<string> {
  try {
    const { customerMailFromAsync } = await import('@/lib/catalog/brand')
    return await customerMailFromAsync()
  } catch {
    return `noreply@${process.env.PLATFORM_DOMAIN || 'jeffistores.in'}`
  }
}

// nodemailer v10 no longer exposes a `Transporter` namespace type; createTransport returns a Mail
// instance, so derive the type from the function's return.
type MailTransport = ReturnType<typeof nodemailer.createTransport>
let transporter: MailTransport | null = null
function getTransporter(): MailTransport {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'email-smtp.us-east-1.amazonaws.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.SES_SMTP_USER,
        pass: process.env.SES_SMTP_PASSWORD,
      },
    })
  }
  return transporter
}

function joinAddrs(v: string | string[] | undefined): string | null {
  if (!v) return null
  return Array.isArray(v) ? v.join(', ') : v
}

async function logMail(opts: {
  to: string
  from: string
  cc: string | null
  bcc: string | null
  subject: string
  html: string | null
  text: string | null
  kind: string
  entityType: string | null
  entityId: string | null
  userId: string | null
  templateName: string | null
  metadata: Record<string, unknown> | null
  status: 'sent' | 'failed' | 'skipped'
  error: string | null
  messageId: string | null
}) {
  try {
    await queryOne(
      `INSERT INTO email_logs (
         user_id, email, from_email, cc, bcc, subject, body_html, body_text,
         template_name, status, kind, entity_type, entity_id, error, message_id, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        opts.userId,
        opts.to,
        opts.from,
        opts.cc,
        opts.bcc,
        opts.subject,
        opts.html,
        opts.text,
        opts.templateName,
        opts.status,
        opts.kind,
        opts.entityType,
        opts.entityId,
        opts.error,
        opts.messageId,
        opts.metadata ? JSON.stringify(opts.metadata) : null,
      ]
    )
  } catch {
    // Audit must never block real mail flow.
  }
}

// Never mail a raw registered variable token: any {store_name} / {{customer_first_name}} / custom
// variable a path forgot to fill is substituted here and logged.
async function guardTokens(o: SendAuditedMailOptions): Promise<SendAuditedMailOptions> {
  if (![o.subject, o.html, o.amp, o.text].some(p => p && findTokenKeys(p).length > 0)) return o
  try {
    const { guardTemplateTokens } = await import('@/lib/templates/variables')
    const to = Array.isArray(o.to) ? o.to[0] : o.to
    return await guardTemplateTokens(o, { to, userId: o.userId, templateName: o.templateName })
  } catch {
    return o
  }
}

export async function sendAuditedMail(input: SendAuditedMailOptions): Promise<{ messageId?: string }> {
  const o = await guardTokens(input)
  // No explicit from → use the CURRENT store's customer sender (tenant on a tenant host, platform
  // off-tenant) instead of a hardcoded "Jeffi Store's", which leaked into tenant-facing mail.
  const from = o.from || (await resolveDefaultFrom())
  const to = Array.isArray(o.to) ? o.to.join(', ') : o.to
  const cc = joinAddrs(o.cc)
  const bcc = joinAddrs(o.bcc)

  // Local kill-switch: when MAIL_DISABLED=true (dev), do NOT hit SES — but still
  // write the audit row so you can see what would have been sent in /admin/audit.
  if (process.env.MAIL_DISABLED === 'true') {
    await logMail({
      to,
      from,
      cc,
      bcc,
      subject: o.subject,
      html: o.redactBody ? null : (o.html ?? null),
      text: o.redactBody ? null : (o.text ?? null),
      kind: o.kind,
      entityType: o.entityType ?? null,
      entityId: o.entityId ?? null,
      userId: o.userId ?? null,
      templateName: o.templateName ?? null,
      metadata: { ...(o.metadata ?? {}), mailDisabled: true },
      status: 'skipped',
      error: null,
      messageId: null,
    })
    return {}
  }

  try {
    if (!(await messagingGateAllows('email', false))) {
      await logMail({
        to,
        from,
        cc,
        bcc,
        subject: o.subject,
        html: o.redactBody ? null : (o.html ?? null),
        text: o.redactBody ? null : (o.text ?? null),
        kind: o.kind,
        entityType: o.entityType ?? null,
        entityId: o.entityId ?? null,
        userId: o.userId ?? null,
        templateName: o.templateName ?? null,
        metadata: { ...(o.metadata ?? {}), walletBlocked: true },
        status: 'skipped',
        error: 'wallet balance too low',
        messageId: null,
      })
      return {}
    }
    const info = await getTransporter().sendMail({
      from,
      to: o.to,
      subject: o.subject,
      html: o.html,
      text: o.text,
      amp: o.amp,
      cc: o.cc,
      bcc: o.bcc,
      replyTo: o.replyTo,
      attachments: o.attachments,
      headers: o.headers,
    })
    await logMail({
      to,
      from,
      cc,
      bcc,
      subject: o.subject,
      html: o.redactBody ? null : (o.html ?? null),
      text: o.redactBody ? null : (o.text ?? null),
      kind: o.kind,
      entityType: o.entityType ?? null,
      entityId: o.entityId ?? null,
      userId: o.userId ?? null,
      templateName: o.templateName ?? null,
      metadata: o.metadata ?? null,
      status: 'sent',
      error: null,
      messageId: info.messageId ?? null,
    })
    await debitEmailCost(info.messageId)
    return { messageId: info.messageId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logMail({
      to,
      from,
      cc,
      bcc,
      subject: o.subject,
      html: o.redactBody ? null : (o.html ?? null),
      text: o.redactBody ? null : (o.text ?? null),
      kind: o.kind,
      entityType: o.entityType ?? null,
      entityId: o.entityId ?? null,
      userId: o.userId ?? null,
      templateName: o.templateName ?? null,
      metadata: o.metadata ?? null,
      status: 'failed',
      error: message.slice(0, 2000),
      messageId: null,
    })
    throw err
  }
}
