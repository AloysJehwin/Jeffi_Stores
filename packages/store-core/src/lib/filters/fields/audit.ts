import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Audit page lists: audit events, mail log, SMS / WhatsApp log (client-safe; the SQL is in
// ../entities/audit.ts). High volume: each shows its last 7 days unless dates are picked, and counts
// stop at LOG_COUNT_CAP.

const opts = (pairs: [string, string][]): FilterOption[] => pairs.map(([value, label]) => ({ value, label }))
const YES_NO = opts([
  ['true', 'Yes'],
  ['false', 'No'],
])
const vh = (label: string, section: string, noun: string) =>
  ({ label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}`, noun }) as const

export const LOG_DEFAULT_DAYS = 7
export const LOG_COUNT_CAP = 10_000

export const AUDIT_FIELDS = defineFields({
  action: {
    label: 'Action',
    type: 'multi-select',
    quick: true,
    section: 'Event',
    options: opts([
      ['create', 'Create'],
      ['update', 'Update'],
      ['delete', 'Delete'],
      ['inventory_adjust', 'Inventory adjust'],
      ['price_change', 'Price change'],
      ['activate', 'Activate'],
      ['deactivate', 'Deactivate'],
      ['feature', 'Feature'],
      ['unfeature', 'Unfeature'],
      ['send', 'Send'],
      ['approve', 'Approve'],
      ['reject', 'Reject'],
      ['import', 'Import'],
      ['export', 'Export'],
      ['permission_change', 'Permission change'],
      ['login', 'Sign in'],
      ['logout', 'Sign out'],
    ]),
  },
  created: { name: ['from', 'to'], label: 'Date', type: 'date-range', section: 'Event' },
  entity_type: vh('Record type', 'Event', 'Events'),
  entity_id: { label: 'Record ID', type: 'text', placeholder: 'Starts with…', section: 'Event' },
  has_diff: { label: 'Has field changes', type: 'toggle', options: YES_NO, section: 'Event' },
  risky: { label: 'Risky actions', type: 'boolean', section: 'Event' },
  admin: vh('Member', 'Who', 'Events'),
  actor: {
    label: 'Done by',
    type: 'multi-select',
    section: 'Who',
    options: opts([
      ['member', 'A team member'],
      ['system', 'System'],
    ]),
  },
})

export const AUDIT_SEARCH = { placeholder: 'Search summaries…', param: 'search' }

const LOG_SEARCH_ALIASES: FilterAlias[] = [{ param: 'q', to: 'search' }]

export const EMAIL_LOG_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Mail',
    options: opts([
      ['sent', 'Sent'],
      ['failed', 'Failed'],
      ['skipped', 'Skipped'],
    ]),
  },
  sent: { name: ['from', 'to'], label: 'Sent', type: 'date-range', section: 'Mail' },
  kind: vh('Kind', 'Mail', 'Emails'),
  template: vh('Template', 'Mail', 'Emails'),
  recipient: { label: 'Recipient', type: 'text', placeholder: 'Email starts with…', section: 'Mail' },
  has_error: { label: 'Has an error', type: 'toggle', options: YES_NO, section: 'Mail' },
})

export const EMAIL_LOG_ALIASES = LOG_SEARCH_ALIASES
export const EMAIL_LOG_SEARCH = { placeholder: 'Search by recipient or subject…', param: 'search' }

export const MESSAGE_LOG_FIELDS = defineFields({
  status: {
    label: 'Status',
    type: 'multi-select',
    quick: true,
    section: 'Message',
    options: opts([
      ['sent', 'Sent'],
      ['failed', 'Failed'],
      ['received', 'Received'],
    ]),
  },
  delivery: {
    label: 'Delivery',
    type: 'multi-select',
    quick: true,
    section: 'Message',
    options: opts([
      ['estimated', 'Awaiting receipt'],
      ['sent', 'Sent'],
      ['delivered', 'Delivered'],
      ['read', 'Read'],
      ['undelivered', 'Undelivered'],
      ['failed', 'Failed'],
      ['none', 'Not tracked'],
    ]),
  },
  sent: { name: ['from', 'to'], label: 'Sent', type: 'date-range', section: 'Message' },
  kind: vh('Kind', 'Message', 'Messages'),
  direction: {
    label: 'Direction',
    type: 'multi-select',
    section: 'Message',
    options: opts([
      ['outbound', 'Outbound'],
      ['inbound', 'Inbound'],
    ]),
  },
  provider: vh('Provider', 'Message', 'Messages'),
  recipient: { label: 'Number', type: 'text', placeholder: 'Starts with…', section: 'Message' },
  has_error: { label: 'Has an error', type: 'toggle', options: YES_NO, section: 'Message' },
})

export const MESSAGE_LOG_ALIASES = LOG_SEARCH_ALIASES
export const MESSAGE_LOG_SEARCH = { placeholder: 'Search by number or message…', param: 'search' }
