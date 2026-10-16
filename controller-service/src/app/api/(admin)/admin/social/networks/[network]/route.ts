import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { chooseTarget, disconnectNetwork, pendingToken } from '@/lib/social/accounts'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ network: string }> }

function oauthNetwork(v: string): Network | null {
  return (NETWORKS as readonly string[]).includes(v) && providerFor(v as Network).oauth ? (v as Network) : null
}

// Where a signed-in network can post (pages, boards, channels, locations), for the picker.
export async function GET(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const network = oauthNetwork((await params).network)
  if (!network) return NextResponse.json({ error: 'Unknown network' }, { status: 404 })
  const token = await pendingToken(await resolveTenantId(), network)
  if (!token) return NextResponse.json({ error: 'Sign in first' }, { status: 409 })
  try {
    return NextResponse.json({ targets: await providerFor(network).oauth!.listTargets(token) })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? 'Could not load targets') }, { status: 502 })
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const network = oauthNetwork((await params).network)
  if (!network) return NextResponse.json({ error: 'Unknown network' }, { status: 404 })
  const body = await readJson(request)
  if (typeof body?.id !== 'string' || !body.id) return NextResponse.json({ error: 'Choose a target' }, { status: 400 })
  const tenantId = await resolveTenantId()
  const token = await pendingToken(tenantId, network)
  if (!token) return NextResponse.json({ error: 'Sign in first' }, { status: 409 })
  // The target must be one this sign-in can reach, not any id the browser sends.
  const target = (await providerFor(network).oauth!.listTargets(token)).find(t => t.id === body.id)
  if (!target) return NextResponse.json({ error: 'That target is not available for this sign-in' }, { status: 400 })
  await chooseTarget(tenantId, network, target)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const network = oauthNetwork((await params).network)
  if (!network) return NextResponse.json({ error: 'Unknown network' }, { status: 404 })
  await disconnectNetwork(await resolveTenantId(), network)
  return NextResponse.json({ ok: true })
}
