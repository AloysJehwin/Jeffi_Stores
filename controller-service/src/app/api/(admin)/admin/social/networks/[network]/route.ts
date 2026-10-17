import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { readJson } from '@/lib/channels/route'
import { chooseTarget, disconnectNetwork, pendingToken } from '@/lib/social/accounts'
import { NETWORKS, providerFor, type Network } from '@/lib/social/providers'
import { gbpQuotaHint } from '@/lib/social/providers/gbp'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ network: string }> }

const errorText = (e: any) => String(e?.message ?? e ?? 'Could not load targets')
const hintFor = (network: Network, msg: string) => (network === 'gbp' ? gbpQuotaHint(msg) : null)

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
    const error = errorText(e)
    return NextResponse.json({ error, hint: hintFor(network, error) }, { status: 502 })
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'social:write')
  if (admin instanceof NextResponse) return admin
  const network = oauthNetwork((await params).network)
  if (!network) return NextResponse.json({ error: 'Unknown network' }, { status: 404 })
  const body = await readJson(request)
  if (typeof body?.id !== 'string' || !body.id.trim()) return NextResponse.json({ error: 'Choose a target' }, { status: 400 })
  const tenantId = await resolveTenantId()
  const token = await pendingToken(tenantId, network)
  if (!token) return NextResponse.json({ error: 'Sign in first' }, { status: 409 })
  const id = body.id.trim().slice(0, 512)
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : id
  // When the sign-in can list, the target must be one it reaches. When listing fails (quota,
  // missing permission) the admin's own id is taken as is.
  let targets: { id: string; name: string }[] | null = null
  try {
    targets = await providerFor(network).oauth!.listTargets(token)
  } catch {}
  if (targets) {
    const target = targets.find(t => t.id === id)
    if (!target) return NextResponse.json({ error: 'That target is not available for this sign-in' }, { status: 400 })
    await chooseTarget(tenantId, network, target)
  } else await chooseTarget(tenantId, network, { id, name })
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
