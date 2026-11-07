import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { readJson } from '@/lib/channels/route'
import { PLATFORM_ITEM_IDS } from '@/lib/setup-guide/registry'
import { setPlatformProgress } from '@/lib/setup-guide/progress'
import { getPlatformApps } from '@/lib/setup-guide/status'
import { ManualBody, issue, setupTenantId } from '@/lib/setup-guide/route'

export const dynamic = 'force-dynamic'

// Platform apps: approvals only the platform does. The administrator on the flagship admin only, so
// key presence reflects this admin-service's own secret set; a store admin never reaches it.

async function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  const tenant = await setupTenantId().catch(() => 'unknown')
  if (!isPlatformAdmin(admin.role) || tenant) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

export async function GET(request: NextRequest) {
  const admin = await platformOnly(await requireAdminScope(request, 'setup_guide:read'))
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await getPlatformApps())
  } catch (e) {
    console.error('[setup-guide] platform load failed', e)
    return NextResponse.json({ error: 'Could not load the platform apps' }, { status: 500 })
  }
}

const Body = ManualBody.extend({ itemId: z.string().min(1).max(64) })

export async function PATCH(request: NextRequest) {
  const admin = await platformOnly(await requireAdminScope(request, 'setup_guide:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: issue(parsed.error) }, { status: 400 })
  const b = parsed.data
  if (!PLATFORM_ITEM_IDS.has(b.itemId)) return NextResponse.json({ error: 'Unknown item' }, { status: 404 })
  try {
    await setPlatformProgress(b.itemId, { state: b.state, appliedAt: b.state === 'applied' ? (b.appliedAt ?? null) : null, note: b.note ?? null }, admin.email ?? null)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[setup-guide] platform save failed', e)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
