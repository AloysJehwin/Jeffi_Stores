import nodemailer from 'nodemailer'
import { sesConnections, sesSend } from '@jeffi/mail-shell'

// SES over SMTP — the same transport the monolith's mail-audit.ts uses.
type Transport = { sendMail(o: Record<string, unknown>): Promise<{ response?: string; messageId?: string }> }
let transport: Transport | undefined
function t() {
  if (transport) return transport
  const user = process.env.SES_SMTP_USER
  const pass = process.env.SES_SMTP_PASSWORD
  if (!user || !pass) throw new Error('SES_SMTP_USER / SES_SMTP_PASSWORD not set')
  transport = nodemailer.createTransport({
    pool: true,
    maxConnections: sesConnections(),
    host: process.env.SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  }) as Transport
  return transport
}

export const emailConfigured = () => !!(process.env.SES_SMTP_USER && process.env.SES_SMTP_PASSWORD)

/** Returns SES's own message id (a reply's In-Reply-To is <id>@email.amazonses.com), else nodemailer's. */
// Paced to the SES account rate and retried when throttled; bulk jobs use the bulk share.
export async function sendEmail(o: { to: string; from: string; subject: string; html: string; replyTo?: string; inReplyTo?: string; bulk?: boolean }): Promise<string> {
  const text = o.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const info = await sesSend(() => t().sendMail({ to: o.to, from: o.from, subject: o.subject, html: o.html, text, replyTo: o.replyTo, inReplyTo: o.inReplyTo, references: o.inReplyTo }), o.bulk ? 'bulk' : 'transactional')
  const ses = /^250 Ok (\S+)/i.exec(String(info.response ?? ''))?.[1]
  return ses ?? String(info.messageId ?? '')
}
