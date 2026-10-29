import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'

// Agent chats belong to the admin who started them. Nobody else can read or continue one unless the
// owner shares it, and a shared chat is read-only for everyone but the owner.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADMIN_NAME = "COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)"
export const TITLE_MAX = 160

export type ConversationAccess = 'owner' | 'shared' | 'denied' | 'none'

export interface PageContext {
  path?: string
  section?: string
  entity?: { kind: string; id: string }
  /** The page's query string (list filters, search), without the leading '?'. */
  query?: string
}

export interface ConversationSummary {
  id: string
  title: string | null
  shared: boolean
  last_message_at: string
  message_count: number
}

const titleOf = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || null

/** The caller's access to a conversation. Chats from before the conversations table get their row
 *  from their first message's author. */
export async function conversationAccess(adminId: string, id: string): Promise<ConversationAccess> {
  if (!UUID_RE.test(id)) return 'none'
  let row = await queryOne<{ admin_id: string; shared: boolean }>(
    `SELECT admin_id::text, shared_at IS NOT NULL AS shared FROM admin_agent_conversations WHERE id = $1::uuid`,
    [id]
  )
  if (!row) {
    row = await queryOne<{ admin_id: string; shared: boolean }>(
      `INSERT INTO admin_agent_conversations (id, admin_id, title, created_at, last_message_at)
       SELECT $1::uuid, m.admin_id, (SELECT left(content, ${TITLE_MAX}) FROM admin_agent_messages
                                     WHERE conversation_id = $1::uuid AND role = 'user' ORDER BY created_at LIMIT 1),
              m.created_at, now()
         FROM admin_agent_messages m WHERE m.conversation_id = $1::uuid ORDER BY m.created_at LIMIT 1
       ON CONFLICT (id) DO NOTHING
       RETURNING admin_id::text, false AS shared`,
      [id]
    )
    row ??= await queryOne<{ admin_id: string; shared: boolean }>(
      `SELECT admin_id::text, shared_at IS NOT NULL AS shared FROM admin_agent_conversations WHERE id = $1::uuid`,
      [id]
    )
    if (!row) return 'none'
  }
  if (row.admin_id === adminId) return 'owner'
  return row.shared ? 'shared' : 'denied'
}

/** The conversation this turn writes to: the caller's own, or a new one. Null = not theirs. */
export async function startTurn(
  adminId: string,
  requested: string | undefined,
  firstMessage: string,
  context: PageContext | null
): Promise<string | null> {
  const id = requested && UUID_RE.test(requested) ? requested : crypto.randomUUID()
  const access = requested ? await conversationAccess(adminId, id) : 'none'
  if (access === 'owner') {
    await query(`UPDATE admin_agent_conversations SET last_message_at = now() WHERE id = $1::uuid`, [id])
    return id
  }
  if (access !== 'none') return null
  await query(
    `INSERT INTO admin_agent_conversations (id, admin_id, title, context) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
    [id, adminId, titleOf(firstMessage), JSON.stringify(context ?? {})]
  )
  return id
}

export async function listConversations(adminId: string, limit: number): Promise<ConversationSummary[]> {
  return queryMany<ConversationSummary>(
    `SELECT c.id::text, c.title, c.shared_at IS NOT NULL AS shared, c.last_message_at::text,
            (SELECT count(*)::int FROM admin_agent_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM admin_agent_conversations c
      WHERE c.admin_id = $1::uuid
      ORDER BY c.last_message_at DESC
      LIMIT $2`,
    [adminId, limit]
  )
}

export async function conversationMeta(id: string) {
  return queryOne<{ title: string | null; shared: boolean; owner_name: string }>(
    `SELECT c.title, c.shared_at IS NOT NULL AS shared, ${ADMIN_NAME} AS owner_name
       FROM admin_agent_conversations c
       JOIN admins a ON a.id = c.admin_id
       JOIN users u ON u.id = a.user_id
      WHERE c.id = $1::uuid`,
    [id]
  )
}

/** Owner-only edits; false when the conversation isn't the caller's. */
export async function updateConversation(adminId: string, id: string, patch: { title?: string; shared?: boolean }): Promise<boolean> {
  const sets: string[] = []
  const params: unknown[] = [id, adminId]
  if (patch.title !== undefined) {
    params.push(titleOf(patch.title))
    sets.push(`title = $${params.length}`)
  }
  if (patch.shared !== undefined) sets.push(`shared_at = ${patch.shared ? 'COALESCE(shared_at, now())' : 'NULL'}`)
  if (!sets.length) return true
  const r = await query(
    `UPDATE admin_agent_conversations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1::uuid AND admin_id = $2::uuid`,
    params
  )
  return (r.rowCount ?? 0) > 0
}

export async function deleteConversation(adminId: string, id: string): Promise<boolean> {
  return withTransaction(async client => {
    const r = await client.query(`DELETE FROM admin_agent_conversations WHERE id = $1::uuid AND admin_id = $2::uuid`, [id, adminId])
    if (!r.rowCount) return false
    await client.query(`DELETE FROM admin_agent_messages WHERE conversation_id = $1::uuid`, [id])
    return true
  })
}
