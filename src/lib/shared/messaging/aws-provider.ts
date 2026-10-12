import type { SmsProvider, WhatsAppProvider } from './types'

// AWS End User Messaging provider — STUB. Selected via the Site Controls "provider" toggle, but not
// implemented until the AWS WABA + SMS origination are onboarded and templates are Meta-approved
// (see the Twilio→AWS migration runbook, Phase 5). Until then every send throws, which the callers
// log as a 'failed' message and surface — so flipping a tenant to AWS prematurely fails loudly, not
// silently. Phase 5 replaces the throws with socialmessaging `send-whatsapp-message` + SNS/End User
// Messaging SMS calls, keeping this same interface.

const NOT_READY = 'AWS messaging provider is not configured yet (migration pending)'

export const awsSmsProvider: SmsProvider = {
  configured: false,
  name: 'aws',
  from: process.env.AWS_SMS_FROM || '',
  async sendText() {
    throw new Error(NOT_READY)
  },
}

export const awsWhatsAppProvider: WhatsAppProvider = {
  configured: false,
  name: 'aws',
  from: process.env.AWS_WHATSAPP_FROM || '',
  async sendTemplate() {
    throw new Error(NOT_READY)
  },
  async sendText() {
    throw new Error(NOT_READY)
  },
}
