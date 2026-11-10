import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { removeSignInMethod, saveSignInMethod } from '@/lib/auth/social/config'
import { isSocialProvider } from '@/lib/auth/social/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ provider: string }> }

/** Switch a method on or off and/or save the store's own app. Blank secret fields keep the stored secret. */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const { provider } = await ctx.params
  if (!isSocialProvider(provider)) return NextResponse.json({ error: 'Unknown sign-in method' }, { status: 404 })
  const b = await request.json().catch(() => null)
  if (!b || typeof b !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const res = await saveSignInMethod(await credentialOwnerId(), provider, {
      enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
      clientId: b.clientId,
      clientSecret: b.clientSecret,
      teamId: b.teamId,
      keyId: b.keyId,
      privateKey: b.privateKey,
    })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true, method: res.method })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

/** Remove the store's own app for this method. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const { provider } = await ctx.params
  if (!isSocialProvider(provider)) return NextResponse.json({ error: 'Unknown sign-in method' }, { status: 404 })
  try {
    return NextResponse.json({ ok: true, method: await removeSignInMethod(await credentialOwnerId(), provider) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
