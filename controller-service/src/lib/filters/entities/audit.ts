import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { RISKY_ACTIONS, RISKY_ENTITIES } from '@/lib/overviews/audit'
import {
  AUDIT_FIELDS,
  EMAIL_LOG_ALIASES,
  EMAIL_LOG_FIELDS,
  LOG_DEFAULT_DAYS,
  MESSAGE_LOG_ALIASES,
  MESSAGE_LOG_FIELDS,
} from '../fields/audit'

// Audit page lists: admin_audit_log, email_logs and message_logs (one entity per channel). Logs
// hold recipients, emails and numbers, so exports need audit:write. No facets: value help counts
// only the date window.

type AuditKey = FieldKeys<typeof AUDIT_FIELDS>
type EmailKey = FieldKeys<typeof EMAIL_LOG_FIELDS>
type MessageKey = FieldKeys<typeof MESSAGE_LOG_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS')`
const ADMIN_NAME = "COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)"
const LOG_EXPORT_CAP = 100_000
const quoted = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(', ')

/** ILIKE contains on any of `cols`, one escaped pattern. */
const likeSearch = (cols: string[]) => (s: string, idx: number) => ({
  clause: `(${cols.map(c => `${c} ILIKE $${idx}`).join(' OR ')})`,
  params: [`%${escapeLike(s)}%`],
  nextIdx: idx + 1,
})

const AUDIT_SQL: Record<AuditKey, FieldSql> = {
  action: { kind: 'enum', expr: 'l.action' },
  created: { kind: 'date', expr: 'l.created_at' },
  entity_type: { kind: 'values', expr: 'l.entity_type' },
  entity_id: { kind: 'text', expr: 'l.entity_id', match: 'prefix' },
  has_diff: { kind: 'bool', expr: "COALESCE(jsonb_typeof(l.diff) = 'object' AND l.diff <> '{}'::jsonb, false)" },
  // The overview's "risky" (deletes, imports, exports, access and settings changes).
  risky: {
    kind: 'flag',
    expr: `(l.action IN (${quoted(RISKY_ACTIONS)}) OR l.entity_type IN (${quoted(RISKY_ENTITIES)}))`,
  },
  admin: {
    kind: 'values',
    lateral: { from: 'admins a JOIN users u ON u.id = a.user_id', link: 'a.id = l.admin_id', expr: ADMIN_NAME },
  },
  actor: { kind: 'enum', virtual: { member: 'l.admin_id IS NOT NULL', system: 'l.admin_id IS NULL' } },
}

export const AUDIT_ENTITY: FilterEntity<AuditKey> = {
  key: 'audit',
  scope: 'audit:read',
  exportScope: 'audit:write',
  noun: 'Events',
  root: 'admin_audit_log',
  alias: 'l',
  fields: AUDIT_FIELDS,
  sql: AUDIT_SQL,
  period: 'created',
  search: { build: likeSearch(['l.summary']) },
  defaultWindowDays: LOG_DEFAULT_DAYS,
  export: {
    columns: [
      { key: 'date', label: 'Date', sql: IST('l.created_at') },
      {
        key: 'member',
        label: 'Member',
        sql: `COALESCE((SELECT ${ADMIN_NAME} FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = l.admin_id),
          CASE WHEN l.admin_id IS NULL THEN 'System' END)`,
      },
      { key: 'action', label: 'Action', sql: 'l.action' },
      { key: 'entity_type', label: 'Record type', sql: 'l.entity_type' },
      { key: 'entity_id', label: 'Record ID', sql: 'l.entity_id' },
      { key: 'summary', label: 'Summary', sql: 'l.summary' },
      {
        key: 'fields',
        label: 'Changed fields',
        sql: `CASE WHEN jsonb_typeof(l.diff) = 'object' THEN (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(l.diff) k) END`,
      },
      { key: 'ip', label: 'IP address', sql: 'host(l.ip_address)' },
    ],
    keyset: ['l.created_at', 'l.id'],
    cap: LOG_EXPORT_CAP,
  },
}

const EMAIL_SQL: Record<EmailKey, FieldSql> = {
  status: { kind: 'enum', expr: 'e.status' },
  sent: { kind: 'date', expr: 'e.sent_at' },
  kind: { kind: 'values', expr: 'e.kind' },
  template: { kind: 'values', expr: 'e.template_name' },
  recipient: { kind: 'text', expr: 'e.email', match: 'prefix' },
  has_error: { kind: 'bool', expr: "COALESCE(btrim(e.error), '') <> ''" },
}

export const EMAIL_LOG_ENTITY: FilterEntity<EmailKey> = {
  key: 'logs.email',
  scope: 'audit:read',
  exportScope: 'audit:write',
  noun: 'Emails',
  root: 'email_logs',
  alias: 'e',
  fields: EMAIL_LOG_FIELDS,
  sql: EMAIL_SQL,
  period: 'sent',
  aliases: EMAIL_LOG_ALIASES,
  search: { build: likeSearch(['e.email', 'e.subject']) },
  defaultWindowDays: LOG_DEFAULT_DAYS,
  export: {
    columns: [
      { key: 'sent', label: 'Sent', sql: IST('e.sent_at') },
      { key: 'to', label: 'To', sql: 'e.email' },
      { key: 'cc', label: 'CC', sql: 'e.cc' },
      { key: 'bcc', label: 'BCC', sql: 'e.bcc' },
      { key: 'from', label: 'From', sql: 'e.from_email' },
      { key: 'subject', label: 'Subject', sql: 'e.subject' },
      { key: 'kind', label: 'Kind', sql: 'e.kind' },
      { key: 'template', label: 'Template', sql: 'e.template_name' },
      { key: 'status', label: 'Status', sql: 'e.status' },
      { key: 'error', label: 'Error', sql: 'e.error' },
      { key: 'entity_type', label: 'Record type', sql: 'e.entity_type' },
      { key: 'entity_id', label: 'Record ID', sql: 'e.entity_id' },
      { key: 'message_id', label: 'Message ID', sql: 'e.message_id' },
    ],
    keyset: ['e.sent_at', 'e.id'],
    cap: LOG_EXPORT_CAP,
  },
}

const MESSAGE_SQL: Record<MessageKey, FieldSql> = {
  status: { kind: 'enum', expr: 'm.status' },
  delivery: { kind: 'enum', expr: 'm.delivery_status', virtual: { none: 'm.delivery_status IS NULL' } },
  sent: { kind: 'date', expr: 'm.sent_at' },
  kind: { kind: 'values', expr: 'm.kind' },
  direction: { kind: 'enum', expr: 'm.direction' },
  provider: { kind: 'values', expr: 'm.provider' },
  // With or without the +91 country code.
  recipient: { kind: 'text', expr: ['m.to_number', "regexp_replace(m.to_number, '^\\+?91', '')"], match: 'prefix' },
  has_error: { kind: 'bool', expr: "COALESCE(btrim(m.error), '') <> ''" },
}

/** message_logs filtered to one channel; without one, every channel (the API's old default). */
export function messageLogEntity(channel?: 'sms' | 'whatsapp'): FilterEntity<MessageKey> {
  return {
    key: channel ? `logs.${channel}` : 'logs.messages',
    scope: 'audit:read',
    exportScope: 'audit:write',
    noun: 'Messages',
    root: 'message_logs',
    alias: 'm',
    base: channel ? [`m.channel = '${channel}'`] : [],
    fields: MESSAGE_LOG_FIELDS,
    sql: MESSAGE_SQL,
    period: 'sent',
    aliases: MESSAGE_LOG_ALIASES,
    search: { build: likeSearch(['m.to_number', 'm.body']) },
    defaultWindowDays: LOG_DEFAULT_DAYS,
    export: {
      columns: [
        { key: 'sent', label: 'Sent', sql: IST('m.sent_at') },
        { key: 'direction', label: 'Direction', sql: 'm.direction' },
        { key: 'to', label: 'To', sql: 'm.to_number' },
        { key: 'from', label: 'From', sql: 'm.from_number' },
        { key: 'kind', label: 'Kind', sql: 'm.kind' },
        { key: 'status', label: 'Status', sql: 'm.status' },
        { key: 'delivery', label: 'Delivery', sql: 'm.delivery_status' },
        { key: 'provider', label: 'Provider', sql: 'm.provider' },
        { key: 'price', label: 'Price', sql: 'm.price' },
        { key: 'currency', label: 'Currency', sql: 'm.currency' },
        { key: 'error', label: 'Error', sql: 'm.error' },
        { key: 'body', label: 'Message', sql: 'm.body' },
        { key: 'entity_type', label: 'Record type', sql: 'm.entity_type' },
        { key: 'entity_id', label: 'Record ID', sql: 'm.entity_id' },
        { key: 'provider_sid', label: 'Provider ID', sql: 'm.provider_sid' },
      ],
      keyset: ['m.sent_at', 'm.id'],
      cap: LOG_EXPORT_CAP,
    },
  }
}

export const SMS_LOG_ENTITY = messageLogEntity('sms')
export const WHATSAPP_LOG_ENTITY = messageLogEntity('whatsapp')
