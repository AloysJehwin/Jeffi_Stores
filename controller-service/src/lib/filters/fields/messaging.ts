import { defineFields, type FilterOption } from '@jeffi/list-filters/client'

// Messaging broadcast (email_campaigns) filters (client-safe; the SQL is in ../entities/messaging.ts).

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))

export const MESSAGING_FIELDS = defineFields({
  channel: {
    label: 'Channel',
    type: 'multi-select',
    quick: true,
    section: 'Message',
    options: opts([
      ['email', 'Email'],
      ['sms', 'SMS'],
      ['whatsapp', 'WhatsApp'],
      ['push', 'App push'],
    ]),
  },
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Message',
    options: opts([
      ['draft', 'Draft'],
      ['scheduled', 'Scheduled'],
      ['sending', 'Sending'],
      ['sent', 'Sent'],
      ['failed', 'Failed'],
    ]),
  },
  kind: { label: 'Template', type: 'value-help', section: 'Message', noun: 'Messages' },
  sent: { name: ['from', 'to'], label: 'Sent on', type: 'date-range', section: 'Message' },
  recipients: { label: 'Recipients', type: 'range', section: 'Message' },
})

export const MESSAGING_SEARCH = { placeholder: 'Search by title or subject...', param: 'search' }
