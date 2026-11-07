import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { oauthRedirectUri } from '@/lib/integrations/oauth'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'
import { readJson } from '@/lib/channels/route'
import { deleteOwnMetaApp, readOwnMetaApp, saveOwnMetaApp, verifyMetaApp } from '@/lib/catalog/meta'

export const dynamic = 'force-dynamic'

// A store's own Meta app, used for Social Posts and Meta Ads sign-in instead of the platform's. Both
// features share it, so either feature's scope manages it. The secret is never returned.

async function gate(request: NextRequest, write: boolean): Promise<NextResponse | { tenantId: string }> {
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin
  const has = (s: string) => hasScope(admin.role, admin.scopes || [], s)
  const ok = write
    ? hasScope(admin.role, admin.scopes || [], 'social:write') || hasScope(admin.role, admin.scopes || [], 'meta_ads:write')
    : has('social:read') || has('meta_ads:read')
  if (!ok) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return { tenantId: await credentialOwnerId() }
}

export async function GET(request: NextRequest) {
  const g = await gate(request, false)
  if (g instanceof NextResponse) return g
  const own = await readOwnMetaApp(g.tenantId)
  const store = await storeBaseUrlAsync()
  const app = own ? `?app=${own.appId}` : ''
  return NextResponse.json({
    own: !!own,
    ...(own
      ? { appId: own.appId, loginConfigId: own.loginConfigId ?? null, adsLoginConfigId: own.adsLoginConfigId ?? null }
      : {}),
    redirectUris: [oauthRedirectUri('meta'), oauthRedirectUri('meta_ads')],
    deauthorizeUrl: `${store}/api/meta/deauthorize${app}`,
    dataDeletionUrl: `${store}/api/meta/data-deletion${app}`,
  })
}

const id = z.string().trim().regex(/^\d{5,25}$/, 'Meta ids are numbers')
const Body = z.object({
  appId: id,
  appSecret: z.string().trim().min(16, 'Paste the App Secret').max(128).optional().or(z.literal('')),
  loginConfigId: id.optional().or(z.literal('')),
  adsLoginConfigId: id.optional().or(z.literal('')),
})

/** Save the app after checking the id and secret with Meta. Leaving the secret blank keeps the saved one. */
export async function POST(request: NextRequest) {
  const g = await gate(request, true)
  if (g instanceof NextResponse) return g
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const b = parsed.data
  const current = await readOwnMetaApp(g.tenantId)
  const appSecret = b.appSecret || (current?.appId === b.appId ? current.appSecret : '')
  if (!appSecret) return NextResponse.json({ error: 'Paste the App Secret' }, { status: 400 })
  try {
    await verifyMetaApp(b.appId, appSecret)
  } catch (e: any) {
    return NextResponse.json({ error: `Meta did not accept this app: ${String(e?.message ?? e).slice(0, 200)}` }, { status: 400 })
  }
  await saveOwnMetaApp(g.tenantId, {
    appId: b.appId,
    appSecret,
    loginConfigId: b.loginConfigId || null,
    adsLoginConfigId: b.adsLoginConfigId || null,
  })
  return NextResponse.json({ ok: true, own: true, appId: b.appId })
}

export async function DELETE(request: NextRequest) {
  const g = await gate(request, true)
  if (g instanceof NextResponse) return g
  await deleteOwnMetaApp(g.tenantId)
  return NextResponse.json({ ok: true })
}
