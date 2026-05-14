import { NextRequest, NextResponse } from 'next/server'
import { suggestIcon } from '@/lib/iconSuggest'
import { authenticateAdmin } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const iconName = await suggestIcon(name.trim())
  return NextResponse.json({ iconName })
}
