import { query, queryMany, queryOne } from '@/lib/shared/db'

// The customer's in-app inbox (notifications). Every push lands here too, so nothing is lost when a
// push is dismissed or the permission is off.

export interface InboxItem {
  id: string
  type: string
  category: string | null
  title: string
  body: string | null
  link: string | null
  image_url: string | null
  is_read: boolean
  opened_at: string | null
  created_at: string
}

const PAGE = 20

// Opaque keyset cursor over (created_at, id).
const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`).toString('base64url')
function decodeCursor(c: string | null | undefined): { at: string; id: string } | null {
  if (!c) return null
  const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|')
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { at, id }
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND is_read = false`, [userId])
  return Number(r?.n ?? 0)
}

export async function listInbox(
  userId: string,
  cursor?: string | null
): Promise<{ items: InboxItem[]; next_cursor: string | null; unread_count: number }> {
  const after = decodeCursor(cursor)
  const [rows, unread] = await Promise.all([
    // cursor_at keeps microseconds; a millisecond ISO string would re-serve rows on the next page.
    queryMany<InboxItem & { created_at: Date | string; opened_at: Date | string | null; cursor_at: string }>(
      `SELECT id, type, category, title, message AS body, link, image_url, COALESCE(is_read, false) AS is_read, opened_at, created_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM notifications
       WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT ${PAGE + 1}`,
      [userId, after?.at ?? null, after?.id ?? null]
    ),
    unreadCount(userId),
  ])
  const iso = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
  const page = rows.slice(0, PAGE)
  const items = page.map(({ cursor_at: _c, ...r }) => ({ ...r, created_at: iso(r.created_at)!, opened_at: iso(r.opened_at) }))
  const last = page[page.length - 1]
  return { items, next_cursor: rows.length > PAGE && last ? encodeCursor(last.cursor_at, last.id) : null, unread_count: unread }
}

/** Mark the given ids, or everything, as read. Returns the remaining unread count. */
export async function markRead(userId: string, opts: { ids?: string[]; all?: boolean }): Promise<number> {
  if (opts.all) {
    await query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [userId])
  } else if (opts.ids?.length) {
    await query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = false`, [userId, opts.ids])
  }
  return unreadCount(userId)
}

/**
 * Tap tracking: the first open wins; opening also marks it read. A scenario push's open also counts
 * as the click on its push:<kind> send, so attributeConversion credits an order to it like an email.
 */
export async function markOpened(userId: string, id: string): Promise<boolean> {
  const r = await queryOne<{ id: string; source: string | null; source_ref: string | null }>(
    `UPDATE notifications SET opened_at = COALESCE(opened_at, now()), is_read = true WHERE id = $1 AND user_id = $2
     RETURNING id, source, source_ref`,
    [id, userId]
  )
  if (r?.source === 'scenario' && r.source_ref) {
    await query(
      // A tap older than the latest (re)send belongs to an earlier cycle.
      `UPDATE email_campaigns_sent
          SET opened_at = CASE WHEN opened_at IS NULL OR opened_at < sent_at THEN now() ELSE opened_at END,
              clicked_at = CASE WHEN clicked_at IS NULL OR clicked_at < sent_at THEN now() ELSE clicked_at END
        WHERE campaign_kind = $1 AND user_id = $2 AND reference_id = $3
          AND unsubscribed_at IS NULL AND bounced_at IS NULL AND complained_at IS NULL`,
      [r.source_ref, userId, `push:${r.source_ref}`]
    ).catch(() => {})
  }
  return !!r
}
