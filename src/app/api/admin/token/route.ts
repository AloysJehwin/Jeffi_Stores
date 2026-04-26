import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = request.cookies.get('admin_token')?.value
  if (!token) return NextResponse.json({ error: 'No active session token' }, { status: 404 })

  return NextResponse.json({ token })
}
