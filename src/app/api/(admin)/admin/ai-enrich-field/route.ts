export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { resolveAiScope, aiDenial } from '@/lib/auth/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { listTemplateVariables } from '@/lib/templates/variables'
import { enrichField, parseEnrichBody } from '@/lib/ai/enrich-field'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const scope = resolveAiScope(body.scope)
  if (!scope) return NextResponse.json({ error: 'Invalid AI scope' }, { status: 400 })
  const denied = aiDenial(admin.role, admin.scopes, scope)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  try {
    const [store, builtins] = await Promise.all([storeDescriptorForPrompt(), listTemplateVariables().catch(() => undefined)])
    const result = await enrichField({ store, builtins, ...parseEnrichBody(body) })
    return NextResponse.json({ result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'AI service error' }, { status: err?.status ?? 503 })
  }
}
