import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { MESSAGING_FIELDS } from '../fields/messaging'

// Messaging broadcasts (email_campaigns c). Template campaigns are email-only; library ones list
// their channels (email / sms / whatsapp / push) as keys of c.channels.

type MessagingKey = FieldKeys<typeof MESSAGING_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')`
const CHANNELS = `(CASE WHEN jsonb_typeof(c.channels) = 'object' THEN c.channels ELSE '{}'::jsonb END)`
const has = (ch: string) => `jsonb_exists(${CHANNELS}, '${ch}')`

const SQL: Record<MessagingKey, FieldSql> = {
  channel: {
    kind: 'enum',
    virtual: {
      email: `(c.template_key IS DISTINCT FROM 'library' OR ${has('email')})`,
      sms: has('sms'),
      whatsapp: has('whatsapp'),
      push: has('push'),
    },
  },
  status: { kind: 'enum', expr: 'c.status' },
  // The template key, or each library slug of a library broadcast.
  kind: {
    kind: 'values',
    expr: "NULLIF(c.template_key, 'library')",
    lateral: { from: `jsonb_each(${CHANNELS}) ch`, link: "jsonb_typeof(ch.value) = 'object'", expr: "ch.value->>'slug'" },
  },
  sent: { kind: 'date', expr: 'c.sent_at' },
  recipients: { kind: 'range', expr: 'c.recipient_count' },
}

export const MESSAGING_ENTITY: FilterEntity<MessagingKey> = {
  key: 'messaging',
  scope: 'mailer:read',
  noun: 'Messages',
  root: 'email_campaigns',
  alias: 'c',
  fields: MESSAGING_FIELDS,
  sql: SQL,
  period: 'sent',
  search: {
    build: (q, idx) => ({
      clause: `(c.title ILIKE $${idx} OR c.subject ILIKE $${idx})`,
      params: [`%${escapeLike(q.trim())}%`],
      nextIdx: idx + 1,
    }),
  },
  facets: true,
  export: {
    columns: [
      { key: 'title', label: 'Title', sql: 'c.title' },
      { key: 'subject', label: 'Subject', sql: 'c.subject' },
      { key: 'template', label: 'Template', sql: 'c.template_key' },
      {
        key: 'channels',
        label: 'Channels',
        sql: `CASE WHEN c.template_key = 'library' THEN (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(${CHANNELS}) k) ELSE 'email' END`,
      },
      { key: 'audience', label: 'Audience', sql: 'c.audience_type' },
      { key: 'recipients', label: 'Recipients', sql: 'c.recipient_count' },
      { key: 'status', label: 'Status', sql: 'c.status' },
      { key: 'scheduled_at', label: 'Scheduled for', sql: IST('c.scheduled_at') },
      { key: 'sent_at', label: 'Sent on', sql: IST('c.sent_at') },
      { key: 'created_at', label: 'Created on', sql: IST('c.created_at') },
    ],
    keyset: ['c.created_at', 'c.id'],
  },
}
