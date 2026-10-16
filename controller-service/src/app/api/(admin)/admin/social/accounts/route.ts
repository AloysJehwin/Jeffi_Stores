import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { saveTenantSocialAccount, deleteTenantSocialAccount } from '@/lib/tenant-registry'
import { getPageInfo } from '@/lib/catalog/meta'
import { encryptToken } from '@/lib/crypto/token-cipher'

export const dynamic = 'force-dynamic'

// Manual Meta connection: the store admin pastes a Page id + Page access token (e.g. from Graph API
// Explorer / a system user) instead of using Facebook Login. The token is checked against the Page
// before it is stored, and the linked IG business account is read from the Page unless given.

const Body = z.object({
  page_id: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'Page ID must be the numeric Facebook Page id'),
  access_token: z.string().trim().min(20, 'Paste the Page access token'),
  ig_user_id: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'Instagram account ID must be numeric')
    .optional()
    .or(z.literal('')),
})

async function gate(request: NextRequest) {
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return { error: admin }
  const tenant = await resolveTenant()
  if (!tenant) return { error: NextResponse.json({ error: 'No tenant context' }, { status: 400 }) }
  return { tenantId: tenant.tenantId }
}

export async function POST(request: NextRequest) {
  const g = await gate(request)
  if ('error' in g) return g.error
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { page_id, access_token } = parsed.data

  let page
  try {
    page = await getPageInfo(page_id, access_token)
  } catch (e: any) {
    return NextResponse.json(
      { error: `Meta rejected the token: ${String(e?.message || e).slice(0, 200)}` },
      { status: 400 }
    )
  }
  if (page.pageId !== page_id) {
    return NextResponse.json({ error: 'That token does not belong to this Page' }, { status: 400 })
  }
  const igUserId = parsed.data.ig_user_id || page.igUserId

  const base = {
    tenantId: g.tenantId,
    pageId: page.pageId,
    pageName: page.pageName,
    accessTokenEnc: encryptToken(access_token),
    tokenExpiry: null,
  }
  await saveTenantSocialAccount({ ...base, provider: 'facebook' })
  if (igUserId) await saveTenantSocialAccount({ ...base, provider: 'instagram', igUserId })
  else await deleteTenantSocialAccount(g.tenantId, 'instagram')

  return NextResponse.json({ ok: true, page_name: page.pageName, instagram: !!igUserId })
}

export async function DELETE(request: NextRequest) {
  const g = await gate(request)
  if ('error' in g) return g.error
  await deleteTenantSocialAccount(g.tenantId)
  return NextResponse.json({ ok: true })
}
