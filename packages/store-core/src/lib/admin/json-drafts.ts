import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import {
  actorOf,
  canDiscard,
  closeDraftLockTx,
  draftLockChips,
  draftLockResponse,
  epochFrom,
  withDraftCreate,
  withDraftWrite,
  type DraftResourceType,
} from '@/lib/admin/draft-locks'

// Wizard drafts kept as one JSON blob per row (id, admin_id, title, fields, created_at, updated_at):
// several per admin, the creator holds the lock, autosave is a PATCH by the holder.

export interface JsonDraftConfig {
  table: string
  type: DraftResourceType
  readScope: string
  writeScope: string
  /** "scenario draft", used in messages. */
  noun: string
  /** Extra list columns read from the row `d`, e.g. `d.fields->>'name' AS name`. */
  listColumns?: string
}

const MAX_PER_ADMIN = 50
const MAX_FIELDS_BYTES = 200_000
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

function parse(body: any): { title?: string | null; fields?: Record<string, unknown> } | string {
  const out: { title?: string | null; fields?: Record<string, unknown> } = {}
  if (body?.title !== undefined) {
    if (body.title !== null && typeof body.title !== 'string') return 'title must be a string'
    out.title = body.title ? String(body.title).trim().slice(0, 128) || null : null
  }
  if (body?.fields !== undefined) {
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) return 'fields must be an object'
    if (JSON.stringify(body.fields).length > MAX_FIELDS_BYTES) return 'This draft is too large to save'
    out.fields = body.fields
  }
  return out
}

/** GET (every draft, newest first) and POST { title?, fields } (start one). */
export function jsonDraftCollection(c: JsonDraftConfig) {
  async function GET(request: NextRequest) {
    const admin = await requireAdminScope(request, c.readScope)
    if (admin instanceof NextResponse) return admin
    const rows = await query(
      `SELECT d.id, d.title, d.updated_at${c.listColumns ? `, ${c.listColumns}` : ''},
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS admin_name
         FROM ${c.table} d
         LEFT JOIN admins a ON a.id = d.admin_id
         LEFT JOIN users u ON u.id = a.user_id
        ORDER BY d.updated_at DESC LIMIT 200`
    )
    const locks = await draftLockChips(c.type, rows.rows.map(r => r.id), admin.adminId)
    return NextResponse.json({ drafts: rows.rows.map(r => ({ ...r, lock: locks[r.id] ?? null })) })
  }

  async function POST(request: NextRequest) {
    const admin = await requireAdminScope(request, c.writeScope)
    if (admin instanceof NextResponse) return admin
    const parsed = parse(await request.json().catch(() => ({})))
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
    const mine = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${c.table} WHERE admin_id = $1`, [admin.adminId])
    if ((mine?.n ?? 0) >= MAX_PER_ADMIN)
      return NextResponse.json({ error: `You already have ${MAX_PER_ADMIN} ${c.noun}s. Finish or discard some first.` }, { status: 409 })
    const id = randomUUID()
    await withDraftCreate(actorOf(admin), c.type, id, db =>
      db.query(`INSERT INTO ${c.table} (id, admin_id, title, fields) VALUES ($1, $2, $3, $4::jsonb)`, [
        id,
        admin.adminId,
        parsed.title ?? null,
        JSON.stringify(parsed.fields ?? {}),
      ])
    )
    return NextResponse.json({ id }, { status: 201 })
  }

  return { GET, POST }
}

type Ctx = { params: Promise<{ id: string }> }

/** GET one, PATCH { title?, fields? } (lock holder only, 423 otherwise), DELETE (discard). */
export function jsonDraftItem(c: JsonDraftConfig) {
  const gone = () => NextResponse.json({ error: `This ${c.noun} was already finished or discarded` }, { status: 404 })

  async function GET(request: NextRequest, { params }: Ctx) {
    const { id } = await params
    const admin = await requireAdminScope(request, c.readScope)
    if (admin instanceof NextResponse) return admin
    const row = isUuid(id) ? await queryOne(`SELECT id, title, fields, updated_at FROM ${c.table} WHERE id = $1`, [id]) : null
    return row ? NextResponse.json({ draft: row }) : gone()
  }

  async function PATCH(request: NextRequest, { params }: Ctx) {
    const { id } = await params
    const admin = await requireAdminScope(request, c.writeScope)
    if (admin instanceof NextResponse) return admin
    if (!isUuid(id)) return gone()
    const parsed = parse(await request.json().catch(() => ({})))
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
    try {
      const r = await withDraftWrite(
        actorOf(admin),
        c.type,
        id,
        db =>
          db.query(
            `UPDATE ${c.table} SET
               title = CASE WHEN $2 THEN $3 ELSE title END,
               fields = COALESCE($4::jsonb, fields),
               updated_at = now()
             WHERE id = $1`,
            [id, parsed.title !== undefined, parsed.title ?? null, parsed.fields ? JSON.stringify(parsed.fields) : null]
          ),
        { epoch: epochFrom(request) }
      )
      if (!r.rowCount) return gone()
    } catch (err) {
      const locked = draftLockResponse(err)
      if (locked) return locked
      throw err
    }
    return NextResponse.json({ ok: true })
  }

  async function DELETE(request: NextRequest, { params }: Ctx) {
    const { id } = await params
    const admin = await requireAdminScope(request, c.writeScope)
    if (admin instanceof NextResponse) return admin
    if (!isUuid(id)) return NextResponse.json({ ok: true })
    const actor = actorOf(admin)
    const allowed = await canDiscard(actor, c.type, id)
    if (!allowed.ok) return NextResponse.json(allowed.error.body(), { status: 423 })
    await withTransaction(async client => {
      const r = await client.query(`DELETE FROM ${c.table} WHERE id = $1`, [id])
      if (r.rowCount) await closeDraftLockTx(client, actor, c.type, id, 'discarded')
    })
    return NextResponse.json({ ok: true })
  }

  return { GET, PATCH, DELETE }
}

/** Inside the finishing write's transaction: drop the draft and close its lock. */
export async function finishJsonDraft(
  client: { query: (text: string, params?: any[]) => Promise<{ rowCount: number | null }> },
  c: JsonDraftConfig,
  admin: { adminId?: string; role?: string; scopes?: string[] },
  id: unknown
): Promise<void> {
  if (typeof id !== 'string' || !isUuid(id)) return
  const r = await client.query(`DELETE FROM ${c.table} WHERE id = $1`, [id])
  if (r.rowCount) await closeDraftLockTx(client as any, actorOf(admin), c.type, id, 'published')
}
