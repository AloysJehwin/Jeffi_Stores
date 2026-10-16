import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { saveNetworkAccount, type StoredTokens } from '@/lib/social/accounts'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'
import { gbpQuotaHint } from '@/lib/social/providers/gbp'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ network: string }> }

// Without a known expiry, a token that comes with a refresh token is renewed within the hour.
const ASSUMED_LIFETIME_MS = 50 * 60_000

const str = (v: unknown, max = 4096) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function manualNetwork(v: string): Network | null {
  if (v === 'facebook' || v === 'instagram') return null
  return (NETWORKS as readonly string[]).includes(v) && providerFor(v as Network).oauth ? (v as Network) : null
}

// Credentials entered by hand (a token from the network's own tools, optionally with the store's
// own app so it can be refreshed). Saved connected; the target is checked when the token can list.
export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const network = manualNetwork((await params).network)
  if (!network) return NextResponse.json({ error: 'Unknown network' }, { status: 404 })
  const body = await readJson(request)
  const accessToken = str(body?.accessToken, 8192)
  const refreshToken = str(body?.refreshToken, 8192)
  const clientId = str(body?.clientId, 512)
  const clientSecret = str(body?.clientSecret, 512)
  const targetId = str(body?.targetId, 512)
  const targetName = str(body?.targetName, 200)
  if (!accessToken) return NextResponse.json({ error: 'Enter the access token' }, { status: 400 })
  if (!targetId) return NextResponse.json({ error: 'Enter the target ID' }, { status: 400 })
  if (!!clientId !== !!clientSecret)
    return NextResponse.json({ error: 'Enter both the Client ID and the Client Secret, or neither' }, { status: 400 })

  const oauth = providerFor(network).oauth!
  const label = providerFor(network).label
  const warnings: string[] = []
  let name = targetName || null
  try {
    const targets = await oauth.listTargets(accessToken)
    const hit = targets.find(t => t.id === targetId)
    if (!hit) {
      const known = targets.map(t => `${t.name} (${t.id})`).join(', ')
      return NextResponse.json(
        { error: `${targetId} is not reachable with this token. ${known ? `It can post to: ${known}.` : 'It has nothing to post to.'}` },
        { status: 400 }
      )
    }
    name = targetName || hit.name
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? 'Could not check the token')
    const hint = network === 'gbp' ? gbpQuotaHint(msg) : null
    warnings.push(`Saved without checking: ${label} refused to list targets (${msg}).${hint ? ` ${hint}` : ''}`)
  }

  const canRefresh = !!refreshToken && (!!clientId || oauth.env.every(k => !!process.env[k]))
  if (refreshToken && !canRefresh)
    warnings.push('Without your app Client ID and Secret the token cannot be refreshed; re-enter it when it expires.')

  const extra: Record<string, string> = { via: 'manual' }
  if (clientId) Object.assign(extra, { clientId, clientSecret })
  const tokens: StoredTokens = {
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: canRefresh ? new Date(Date.now() + ASSUMED_LIFETIME_MS).toISOString() : null,
    extra,
  }
  // The id stands in for a missing name so an earlier target's name is not kept.
  const target = { id: targetId, name: name ?? targetId }
  await saveNetworkAccount(await resolveTenantId(), network, tokens, target)
  return NextResponse.json({ ok: true, target, ...(warnings.length ? { warning: warnings.join(' ') } : {}) })
}
