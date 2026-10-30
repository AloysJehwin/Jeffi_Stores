import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { generateImage } from '@/lib/ai/media'
import { aiMediaErrorResponse } from '@/lib/ai/media-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// Admin-only. Response shape unchanged: { urls: string[] }. Served by the AI gateway and charged
// as generate_image; the old `model` (schnell/dev/pro) maps onto the gateway quality hint.
const QUALITY: Record<string, 'draft' | 'standard' | 'premium'> = { schnell: 'draft', dev: 'standard', pro: 'premium' }

export async function POST(req: NextRequest) {
  const admin = await requireAdminScope(req, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { prompt, width = 1024, height = 1024, model } = body || {}
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  try {
    const r = await generateImage({
      feature: 'generate_image',
      prompt: prompt.trim(),
      width: Math.min(Math.max(256, Number(width) || 1024), 1536),
      height: Math.min(Math.max(256, Number(height) || 1024), 1536),
      n: 1,
      quality: QUALITY[model as string] ?? 'draft',
      actor: admin.email ?? null,
    })
    return NextResponse.json({ urls: r.images.map(i => i.url) })
  } catch (err) {
    return aiMediaErrorResponse(err, 'Generation failed')
  }
}
