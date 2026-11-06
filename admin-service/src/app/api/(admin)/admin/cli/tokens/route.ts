import { NextRequest, NextResponse } from 'next/server'
import { signedInAdmin } from '@/lib/auth/admin-principal'
import { clientInfoFrom, createAdminToken, grantableScopes, listApiTokens, tokenTtlSeconds } from '@/lib/auth/api-tokens'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: the signed-in admin's CLI and extension tokens; ?all=1 lets the store's owner see everyone's,
// service-account keys included. POST: mint a token from this session (the extension card).
export async function GET(request: NextRequest) {
  const admin = await signedInAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const all = request.nextUrl.searchParams.get('all') === '1' && isPlatformOwner(admin.role)
  const tokens = await listApiTokens({ tenantId: admin.tenantId, adminId: all ? undefined : admin.adminId, serviceAccounts: all })

  const adminIds = [...new Set(tokens.map(t => t.adminId).filter((x): x is string => !!x))]
  const saIds = [...new Set(tokens.map(t => t.serviceAccountId).filter((x): x is string => !!x))]
  const [people, accounts] = await Promise.all([
    adminIds.length
      ? queryMany<{ id: string; email: string | null; first_name: string | null; last_name: string | null }>(
          `SELECT a.id, u.email, u.first_name, u.last_name FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = ANY($1::uuid[])`,
          [adminIds]
        )
      : [],
    saIds.length ? queryMany<{ id: string; name: string }>(`SELECT id, name FROM service_accounts WHERE id = ANY($1::uuid[])`, [saIds]) : [],
  ])
  const who = new Map<string, string>()
  for (const p of people) who.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Admin')
  for (const a of accounts) who.set(a.id, a.name)

  return NextResponse.json({
    tokens: tokens.map(t => ({
      ...t,
      holder: who.get(t.serviceAccountId ?? t.adminId ?? '') ?? null,
      mine: t.adminId === admin.adminId,
      live: t.status === 'active' && !t.expired,
    })),
    all,
  })
}

export async function POST(request: NextRequest) {
  const admin = await signedInAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { kind?: unknown; scopes?: unknown; ttl?: unknown; name?: unknown } = {}
  try {
    body = await request.json()
  } catch {}
  const kind = body.kind === 'cli' ? 'cli' : body.kind === 'extension' || body.kind === undefined ? 'extension' : null
  if (!kind) return NextResponse.json({ error: 'kind must be extension or cli' }, { status: 400 })
  const scopes = grantableScopes(body.scopes, { role: admin.role, scopes: admin.scopes, tenantId: admin.tenantId })
  if (!scopes || !scopes.length) return NextResponse.json({ error: 'You can only grant scopes you hold' }, { status: 400 })
  const ttl = tokenTtlSeconds(body.ttl ?? '24h', admin.role)
  if (!ttl) return NextResponse.json({ error: 'ttl must be 1h, 12h, 24h or 7d' }, { status: 400 })

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : kind === 'extension' ? 'Browser extension' : 'Personal token'
  const t = await createAdminToken({ tenantId: admin.tenantId, adminId: admin.adminId, adminRole: admin.role, kind, scopes, ttlSeconds: ttl, client: clientInfoFrom(request, name) })
  return NextResponse.json({ id: t.id, token: t.token, prefix: t.prefix, expires_at: t.expiresAt, scopes, kind }, { status: 201, headers: { 'cache-control': 'no-store' } })
}
