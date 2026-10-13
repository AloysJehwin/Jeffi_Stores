// Default platform template catalog. Copied per tenant on provisioning via
// POST /system-templates/install. Edits to this file do NOT retroactively touch
// existing tenants — a separate "Re-sync defaults" admin action handles that.
//
// Phase 1: scaffold with a working subset per channel. Phase 5 ports every
// current hardcoded body (ecom-emails, automation-emails, sms, whatsapp L33-63)
// into this file 1-for-1.

import type { UpsertInput } from '../src/templates-v2.js'

export type TemplateSeed = Omit<UpsertInput, 'publish'> & {
  tags?: string[]
}

export const CATALOG: TemplateSeed[] = [
  // ── email ───────────────────────────────────────────────────────────
  {
    slug: 'order/confirmed',
    channel: 'email',
    category: 'transactional',
    name: 'Order confirmed',
    description: 'Sent when a customer order is paid and confirmed.',
    subject: 'Order #{{order_number}} confirmed — thanks, {{customer_name}} 🎉',
    body: 'Hi {{customer_name}}, your order #{{order_number}} for ₹{{total}} is confirmed. Track: {{tracking_url}}',
    blocks_format: 'maily',
  },
  {
    slug: 'order/shipped',
    channel: 'email',
    category: 'transactional',
    name: 'Order shipped',
    subject: '📦 Order #{{order_number}} is on the way',
    body: 'Your order #{{order_number}} shipped via {{courier}}. AWB {{awb}} — track at {{tracking_url}}.',
    blocks_format: 'maily',
  },
  {
    slug: 'order/delivered',
    channel: 'email',
    category: 'transactional',
    name: 'Order delivered',
    subject: 'Delivered — enjoy your order #{{order_number}}',
    body: 'Hi {{customer_name}}, order #{{order_number}} has been delivered. Leave a review: {{review_url}}',
    blocks_format: 'maily',
  },
  {
    slug: 'otp/verify',
    channel: 'email',
    category: 'otp',
    name: 'OTP — verify email',
    subject: 'Your verification code: {{code}}',
    body: 'Your code is {{code}}. It expires in {{ttl_minutes}} minutes. Do not share this code.',
    blocks_format: 'maily',
  },
  {
    slug: 'account/welcome',
    channel: 'email',
    category: 'automation',
    name: 'Welcome',
    subject: 'Welcome to {{store_name}} 👋',
    body: 'Hi {{customer_name}}, welcome aboard. Shop: {{store_url}}',
    blocks_format: 'maily',
  },
  {
    slug: 'cart/abandoned',
    channel: 'email',
    category: 'marketing',
    name: 'Abandoned cart',
    subject: 'You left something behind 🛒',
    body: 'Hi {{customer_name}}, your cart (₹{{cart_total}}) is waiting. Resume: {{cart_url}}',
    blocks_format: 'maily',
  },

  // ── sms ─────────────────────────────────────────────────────────────
  {
    slug: 'order/confirmed',
    channel: 'sms',
    category: 'transactional',
    name: 'Order confirmed (SMS)',
    body: '{{store_name}}: Order #{{order_number}} confirmed. ₹{{total}}. Track {{short_url}}',
    blocks_format: 'sms-text',
  },
  {
    slug: 'order/shipped',
    channel: 'sms',
    category: 'transactional',
    name: 'Order shipped (SMS)',
    body: '{{store_name}}: #{{order_number}} shipped via {{courier}}. AWB {{awb}}. {{short_url}}',
    blocks_format: 'sms-text',
  },
  {
    slug: 'otp/verify',
    channel: 'sms',
    category: 'otp',
    name: 'OTP (SMS)',
    body: '{{code}} is your {{store_name}} verification code. Valid for {{ttl_minutes}} min. Do not share.',
    blocks_format: 'sms-text',
  },

  // ── whatsapp ────────────────────────────────────────────────────────
  // provider_ref seeded from env map at install time by the install endpoint
  // for templates already approved under the platform Twilio account.
  {
    slug: 'order/confirmed',
    channel: 'whatsapp',
    category: 'transactional',
    name: 'Order confirmed (WA)',
    body: 'Order #{{1}} confirmed. Total ₹{{2}}. Track: {{3}}',
    meta_category: 'UTILITY',
    blocks_format: 'wa-content',
    blocks: {
      types: {
        'twilio/text': { body: 'Order #{{1}} confirmed. Total ₹{{2}}. Track: {{3}}' },
      },
    },
  },
  {
    slug: 'order/shipped',
    channel: 'whatsapp',
    category: 'transactional',
    name: 'Order shipped (WA)',
    body: 'Order #{{1}} shipped via {{2}}. AWB {{3}}. Track: {{4}}',
    meta_category: 'UTILITY',
    blocks_format: 'wa-content',
    blocks: {
      types: { 'twilio/text': { body: 'Order #{{1}} shipped via {{2}}. AWB {{3}}. Track: {{4}}' } },
    },
  },
  {
    slug: 'otp/verify',
    channel: 'whatsapp',
    category: 'otp',
    name: 'OTP (WA)',
    body: 'Your verification code is {{1}}. Valid for {{2}} minutes.',
    meta_category: 'AUTHENTICATION',
    blocks_format: 'wa-content',
    blocks: {
      types: { 'twilio/text': { body: 'Your verification code is {{1}}. Valid for {{2}} minutes.' } },
    },
  },
]

/** Env fallback for already-approved WA SIDs. Keyed by slug. */
export const WA_APPROVED_SIDS: Record<string, string | undefined> = {
  'order/confirmed': process.env.TWILIO_WA_ORDER_CONFIRMED_SID,
  'order/shipped': process.env.TWILIO_WA_ORDER_SHIPPED_SID,
  'otp/verify': process.env.TWILIO_WA_OTP_SID,
}
