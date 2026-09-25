import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getAiSummary, refreshAiSummary, aiProfileConfigured } from '@/lib/customer-conversations-ai'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { summary, generatedAt } = await getAiSummary(id)
  return NextResponse.json({ summary, generatedAt })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  if (!aiProfileConfigured()) return NextResponse.json({ error: 'AI profile generation is not configured.' }, { status: 503 })

  try {
    const { summary, generatedAt } = await refreshAiSummary(id)
    return NextResponse.json({ summary, generatedAt })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI profile generation failed.' }, { status: 503 })
  }
}
