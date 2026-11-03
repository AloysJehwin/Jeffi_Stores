export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { AI_IMAGE_FEATURES, AI_VIDEO_FEATURES } from '@/lib/ai/media-features'
import { DEFAULT_PRESETS, readPresets, writeTenantPreset } from '@/lib/ai/preset-prompts'

const Query = z.object({
  kind: z.enum(['image', 'video']),
  feature: z.string().min(1).max(64).optional(),
})

// GET /api/admin/ai/preset-prompts?kind=&feature=: merged preset list for the caller tenant.
// Gated on settings:write + AI plan (the dialogs themselves are gated by the feature's own scope;
// this route only lists prompt text, so settings:write is sufficient).
export async function GET(request: NextRequest) {
  const q = Query.safeParse({
    kind: request.nextUrl.searchParams.get('kind') ?? undefined,
    feature: request.nextUrl.searchParams.get('feature') ?? undefined,
  })
  if (!q.success) return NextResponse.json({ error: q.error.issues[0]?.message || 'Invalid query' }, { status: 400 })

  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  try {
    const presets = await readPresets({ kind: q.data.kind, feature: q.data.feature ?? null })
    return NextResponse.json({ presets })
  } catch {
    // Belt-and-braces: readPresets already falls back internally, but if that call itself throws
    // (e.g. no tenant context) still serve the platform defaults so the modal never breaks.
    const presets = DEFAULT_PRESETS.filter(p => p.kind === q.data.kind && (!q.data.feature || !p.feature || p.feature === q.data.feature))
    return NextResponse.json({ presets })
  }
}

const AnyFeature = z
  .enum([...AI_IMAGE_FEATURES, ...AI_VIDEO_FEATURES] as unknown as [string, ...string[]])
  .nullable()
  .optional()

const Body = z.object({
  kind: z.enum(['image', 'video']),
  feature: AnyFeature,
  scenario: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(3).max(2000),
  display_order: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
})

// POST /api/admin/ai/preset-prompts: upsert a tenant override.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid body' }, { status: 400 })

  try {
    const { id } = await writeTenantPreset({
      kind: parsed.data.kind,
      feature: parsed.data.feature ?? null,
      scenario: parsed.data.scenario,
      prompt: parsed.data.prompt,
      display_order: parsed.data.display_order,
      enabled: parsed.data.enabled,
      createdBy: admin.adminId ?? null,
    })
    return NextResponse.json({ id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || 'Save failed' }, { status: 500 })
  }
}
