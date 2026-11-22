import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { oauthRedirectUri } from '@/lib/integrations/oauth'
import { SOCIAL_CALLBACK_PATH } from '@/lib/social/oauth'
import { platformOAuthBaseUrl } from '@/lib/catalog/brand'
import { readJson } from '@/lib/channels/route'
import { deleteOwnApp, isOwnAppFamily, OWN_APP_LABEL, platformApp, platformDefaultApp, readOwnApp, saveOwnApp, type OwnAppFamily } from '@/lib/integrations/own-apps'
import { isPlatformOwner } from '@/lib/integrations/owner'

export const dynamic = 'force-dynamic'

// A store's own OAuth app for one integration family, used for sign-in instead of the platform's.
// Any feature that signs in with the family may manage it. The secret is never returned.

/** Write scopes that may manage each family's app; reading needs the matching :read scope. */
const WRITE_SCOPES: Record<OwnAppFamily, string[]> = {
  google: ['merchant_sync:write', 'google_ads:write', 'social:write'],
  amazon_seller: ['amazon:write'],
  amazon_ads: ['amazon_ads:write'],
  pinterest: ['social:write'],
  linkedin: ['social:write'],
  x: ['social:write'],
}

/** The redirect URIs the store registers on its own app. */
function redirectUris(family: OwnAppFamily): string[] {
  const social = `${platformOAuthBaseUrl()}${SOCIAL_CALLBACK_PATH}`
  switch (family) {
    case 'google':
      return [oauthRedirectUri('google_merchant'), social]
    case 'amazon_seller':
      return [oauthRedirectUri('amazon_seller')]
    case 'amazon_ads':
      return [oauthRedirectUri('amazon_ads')]
    default:
      return [social]
  }
}

async function gate(request: NextRequest, family: string, write: boolean): Promise<NextResponse | { tenantId: string; family: OwnAppFamily }> {
  if (!isOwnAppFamily(family)) return NextResponse.json({ error: 'Unknown app type' }, { status: 404 })
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin
  const ok = WRITE_SCOPES[family].some(s => hasScope(admin.role, admin.scopes || [], write ? s : s.replace(/:write$/, ':read')))
  if (!ok) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return { tenantId: await credentialOwnerId(), family }
}

type Ctx = { params: Promise<{ family: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  const g = await gate(request, (await params).family, false)
  if (g instanceof NextResponse) return g
  const own = await readOwnApp(g.tenantId, g.family)
  return NextResponse.json({
    family: g.family,
    label: OWN_APP_LABEL[g.family],
    own: !!own,
    clientId: own?.clientId ?? null,
    applicationId: own?.applicationId ?? null,
    // The flagship's saved app is every store's default; for the flagship itself only env remains.
    platformReady: isPlatformOwner(g.tenantId) ? !!platformApp(g.family) : !!(await platformDefaultApp(g.family)),
    isPlatform: isPlatformOwner(g.tenantId),
    redirectUris: redirectUris(g.family),
  })
}

const Body = z.object({
  clientId: z.string().trim().min(4, 'Paste the client id').max(256),
  clientSecret: z.string().trim().max(512).optional().or(z.literal('')),
  applicationId: z.string().trim().max(256).optional().or(z.literal('')),
})

/** Save the app. Leaving the secret blank keeps the saved one for the same client id. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const g = await gate(request, (await params).family, true)
  if (g instanceof NextResponse) return g
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const b = parsed.data
  const current = await readOwnApp(g.tenantId, g.family)
  const clientSecret = b.clientSecret || (current?.clientId === b.clientId ? current.clientSecret : '')
  if (!clientSecret) return NextResponse.json({ error: 'Paste the client secret' }, { status: 400 })
  if (g.family === 'amazon_seller' && !/^amzn1\.sp\.solution\./.test(b.applicationId ?? '')) {
    return NextResponse.json({ error: 'Paste the app id (amzn1.sp.solution…) from Seller Central › Develop apps' }, { status: 400 })
  }
  await saveOwnApp(g.tenantId, g.family, { clientId: b.clientId, clientSecret, ...(b.applicationId ? { applicationId: b.applicationId } : {}) })
  return NextResponse.json({ ok: true, own: true, clientId: b.clientId })
}

/** Back to the platform app. Connections made with the own app keep working until they are reconnected. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const g = await gate(request, (await params).family, true)
  if (g instanceof NextResponse) return g
  await deleteOwnApp(g.tenantId, g.family)
  return NextResponse.json({ ok: true, own: false })
}
