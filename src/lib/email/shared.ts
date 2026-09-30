import 'server-only'
import nodemailer from 'nodemailer'
import { queryMany } from '../db'
import { sendAuditedMail } from '../mail-audit'
import {
  customerMailFromAsync,
  adminMailFrom,
  currentBrandName,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  platformAdminEmail,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
} from '../brand'
import { createAdminNotification } from '../admin-notify'
import { mailShell } from '../mail-template'

export { sendAuditedMail, mailShell, createAdminNotification }
export {
  customerMailFromAsync,
  adminMailFrom,
  currentBrandName,
  currentBrandNameAsync,
  currentAdminBaseUrl,
  platformAdminEmail,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
}

/**
 * Store name for email bodies. Synchronous on purpose: templates are built inside string
 * literals, and currentBrandName reads the tenant from AsyncLocalStorage, so it resolves the
 * right store without making every template function await a lookup.
 */
export const storeName = currentBrandName

export const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

export async function getAdminNotificationEmails(): Promise<string> {
  try {
    // 'administrator' is the top role (scopes.ts SUPER_ROLES = ['administrator','super_admin'])
    // and was missing here, so the actual administrative mailbox — admin@jeffistores.in, whose
    // role IS 'administrator' — was excluded from every admin notification while a personal
    // gmail account received them instead.
    const rows = await queryMany<{ email: string }>(
      `SELECT u.email FROM admins a
       JOIN users u ON u.id = a.user_id
       WHERE a.is_active = TRUE
         AND a.role IN ('administrator', 'super_admin', 'admin')
         AND u.email IS NOT NULL
       ORDER BY a.role = 'administrator' DESC, a.role = 'super_admin' DESC`,
      []
    )
    if (rows.length > 0) return rows.map(r => r.email).join(', ')
  } catch {
    /* fall back to ADMIN_EMAIL below */
  }
  // Default is the administrative mailbox on the platform domain, not a personal address.
  return process.env.ADMIN_EMAIL || 'admin@jeffistores.in'
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface AnnouncementProduct {
  id: string
  name: string
  slug: string
  price: string
  short_description: string | null
  primary_image_url?: string | null
}

export type ReturnEmailEvent = 'requested_admin' | 'approved' | 'rejected' | 'received' | 'replacement_created'
