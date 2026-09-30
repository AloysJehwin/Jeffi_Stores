import { NextRequest, NextResponse } from 'next/server'
import { suggestIcon } from '@/lib/shared/icon-suggest'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'categories:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const iconName = await suggestIcon(name.trim())
  return NextResponse.json({ iconName })
}
