import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const faqs = await queryMany(
    `SELECT id, question, answer, sort_order, published FROM category_faqs WHERE category_id = $1 ORDER BY sort_order, created_at`,
    [id]
  )
  return NextResponse.json({ faqs })
}

// PUT { faqs: [{ id?, question, answer, published? }] } — replaces the list; array order is the sort order.
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.faqs)) return NextResponse.json({ error: 'faqs array required' }, { status: 400 })

  const rows = (body.faqs as any[])
    .map((f, i) => ({
      id: UUID_RE.test(String(f?.id ?? '')) ? String(f.id) : null,
      question: String(f?.question ?? '').trim().slice(0, 300),
      answer: String(f?.answer ?? '').trim().slice(0, 2000),
      sort_order: i,
      published: f?.published !== false,
    }))
    .filter(f => f.question && f.answer)
  const json = JSON.stringify(rows)
  const src = `jsonb_to_recordset($2::jsonb) AS n(id uuid, question text, answer text, sort_order int, published boolean)`
  await query(`DELETE FROM category_faqs WHERE category_id = $1 AND id <> ALL($2::uuid[])`, [id, rows.map(r => r.id).filter(Boolean)])
  await query(
    `UPDATE category_faqs f SET question = n.question, answer = n.answer, sort_order = n.sort_order, published = n.published, updated_at = NOW()
       FROM ${src}
      WHERE f.id = n.id AND f.category_id = $1
        AND (f.question, f.answer, f.sort_order, f.published) IS DISTINCT FROM (n.question, n.answer, n.sort_order, n.published)`,
    [id, json]
  )
  await query(
    `INSERT INTO category_faqs (id, category_id, question, answer, sort_order, published)
     SELECT COALESCE(n.id, gen_random_uuid()), $1, n.question, n.answer, n.sort_order, n.published
       FROM ${src}
      WHERE n.id IS NULL OR NOT EXISTS (SELECT 1 FROM category_faqs f WHERE f.id = n.id)`,
    [id, json]
  )
  const faqs = await queryMany(
    `SELECT id, question, answer, sort_order, published FROM category_faqs WHERE category_id = $1 ORDER BY sort_order, created_at`,
    [id]
  )
  return NextResponse.json({ faqs })
}
