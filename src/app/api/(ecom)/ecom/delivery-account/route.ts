import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, saveIntegrationCredential } from '@/lib/tenant-registry'
import { hasOwnDelhiveryToken } from '@/lib/integrations/resolve'
import { verifyDelhiveryToken } from '@/lib/shipping/delhivery'
import { encryptToken } from '@/lib/crypto/token-cipher'

export const dynamic = 'force-dynamic'

const PutSchema = z.object({
  tenantId: z.string().uuid(),
  token: z.string().trim().min(8).max(200),
})

async function ownedTenant(request: NextRequest, tenantId: string | null) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  if (!tenantId) return { error: NextResponse.json({ error: 'tenantId required' }, { status: 400 }) }
  const tenant = (await getOwnerTenants(owner.id)).find(t => t.id === tenantId)
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }
  return { tenant }
}

// GET ?tenantId=... → how this store ships, and whether its own token is on file.
export async function GET(request: NextRequest) {
  const gate = await ownedTenant(request, request.nextUrl.searchParams.get('tenantId'))
  if ('error' in gate) return gate.error
  return NextResponse.json({
    ownDelhivery: gate.tenant.own_delhivery === true,
    tokenConnected: await hasOwnDelhiveryToken(gate.tenant.id),
  })
}

// PUT → replace the Delhivery API token of a store that ships on its own account. The delivery
// mode itself is not switched here: shipments stay tied to the account that created them, so
// moving between the platform account and an own account is a supported operation, not a toggle.
export async function PUT(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = PutSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const gate = await ownedTenant(request, parsed.data.tenantId)
  if ('error' in gate) return gate.error
  if (gate.tenant.own_delhivery !== true) {
    return NextResponse.json(
      { error: 'This store ships on the platform Delhivery account. Contact support to move to your own account.' },
      { status: 409 }
    )
  }

  const check = await verifyDelhiveryToken(parsed.data.token)
  if (check === 'invalid') {
    return NextResponse.json({ error: 'Delhivery did not accept this token. Check it and try again.' }, { status: 400 })
  }
  if (check === 'unverified') {
    return NextResponse.json(
      { error: 'Could not reach Delhivery to verify the token. Your current token is unchanged; try again shortly.' },
      { status: 502 }
    )
  }

  await saveIntegrationCredential({
    tenantId: gate.tenant.id,
    provider: 'delhivery',
    label: 'Delhivery',
    configEnc: encryptToken(JSON.stringify({ token: parsed.data.token })),
    meta: {},
  })
  return NextResponse.json({ ok: true, tokenConnected: true })
}
