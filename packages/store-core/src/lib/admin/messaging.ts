import { buildWhere, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
import type { QueryResultRow } from 'pg'
import { queryCount, queryMany } from '@/lib/shared/db'
import { MESSAGING_ENTITY } from '@/lib/filters/entities/messaging'

// One page of messaging broadcasts over the list's filters, newest first.
const SORT: SortDef = {
  sorts: {
    title: 'c.title',
    template: 'c.template_key',
    audience: 'c.audience_type',
    recipients: 'c.recipient_count',
    status: 'c.status',
    date: 'COALESCE(c.sent_at, c.scheduled_at, c.created_at)',
  },
  defaultSql: 'c.created_at DESC',
  tiebreak: 'c.id DESC',
}

export async function listCampaigns<T extends QueryResultRow>(q: FilterQuery, page: number, pageSize: number, sort?: { get(name: string): string | null }) {
  const w = buildWhere(MESSAGING_ENTITY, q)
  const [campaigns, total] = await Promise.all([
    queryMany<T>(
      `SELECT c.id, c.title, c.template_key, c.channels, c.subject, c.audience_type, c.recipient_count, c.status,
              c.scheduled_at, c.sent_at, c.created_at
       FROM email_campaigns c ${w.where}
       ${sortClause(sort ?? new URLSearchParams(), SORT)} LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`,
      [...w.params, pageSize, (Math.max(1, page) - 1) * pageSize]
    ),
    queryCount(`SELECT COUNT(*) FROM email_campaigns c ${w.where}`, w.params),
  ])
  return { campaigns, total }
}
