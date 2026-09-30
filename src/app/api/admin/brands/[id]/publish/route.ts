import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query, withTransaction } from '@/lib/db'
import type { PoolClient } from 'pg'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'brands:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const draft = await queryOne<{ brand_id: string; fields: Record<string, unknown> }>(
    `SELECT brand_id, fields FROM brand_drafts WHERE brand_id = $1`,
    [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  const f = draft.fields as any
  const prevIsActive = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM brands WHERE id = $1`, [id])

  try {
    await withTransaction(async (client: PoolClient) => {
      const slug =
        f.slug ||
        (f.name
          ? f.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
          : null)

      await client.query(
        `UPDATE brands SET
           name = COALESCE($2, name),
           slug = COALESCE($3, slug),
           description = $4,
           website = $5,
           logo_url = $6,
           is_active = COALESCE($7::boolean, is_active),
           return_allowed = COALESCE($8::boolean, return_allowed),
           return_window_days = COALESCE($9::integer, return_window_days),
           replacement_allowed = COALESCE($10::boolean, replacement_allowed),
           replacement_window_days = COALESCE($11::integer, replacement_window_days)
         WHERE id = $1`,
        [
          id,
          f.name || null,
          slug,
          f.description ?? null,
          f.website ?? null,
          f.logo_url ?? null,
          f.is_active != null ? f.is_active : null,
          f.return_allowed != null ? f.return_allowed : null,
          f.return_window_days != null ? parseInt(f.return_window_days) : null,
          f.replacement_allowed != null ? f.replacement_allowed : null,
          f.replacement_window_days != null ? parseInt(f.replacement_window_days) : null,
        ]
      )

      if (f.is_active != null && f.is_active !== prevIsActive?.is_active) {
        await client.query(`UPDATE products SET is_active = $1 WHERE brand_id = $2`, [f.is_active, id])
      }

      await client.query(`DELETE FROM brand_drafts WHERE brand_id = $1`, [id])
    })

    return NextResponse.json({ success: true, brandId: id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to publish' }, { status: 500 })
  }
}
