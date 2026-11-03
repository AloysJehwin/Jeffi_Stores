import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const SCOPES = ['messages:send', 'templates:read', 'templates:write', 'documents:render', 'documents:read', 'wallet:read'] as const

export async function GET(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const r = await controlPlanePool().query(
    `SELECT k.id, k.name, k.key_prefix, k.scopes, k.rate_limit_per_min, k.status, k.last_used_at, k.created_at,
            COALESCE(SUM(u.requests),0)::int AS requests_30d, COALESCE(SUM(u.spend_paise),0)::bigint AS spend_paise_30d
       FROM api_keys k LEFT JOIN api_key_usage_daily u ON u.api_key_id = k.id AND u.day >= CURRENT_DATE - 30
      WHERE k.tenant_id = $1 GROUP BY k.id ORDER BY k.created_at DESC`,
    [ctx.tenant.id]
  )
  return NextResponse.json({ keys: r.rows })
}

const createSchema = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(SCOPES)).min(1) })

export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(createSchema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const plain = 'jk_live_' + randomBytes(24).toString('base64url')
  const hash = createHash('sha256').update(plain).digest('hex')
  const r = await controlPlanePool().query(
    `INSERT INTO api_keys (owner_id, tenant_id, name, key_prefix, key_hash, scopes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, key_prefix, created_at`,
    [ctx.owner.id, ctx.tenant.id, parsed.data.name, plain.slice(0, 16), hash, parsed.data.scopes]
  )
  // Plaintext is returned exactly once.
  return NextResponse.json({ id: r.rows[0].id, key: plain, key_prefix: r.rows[0].key_prefix, created_at: r.rows[0].created_at })
}
