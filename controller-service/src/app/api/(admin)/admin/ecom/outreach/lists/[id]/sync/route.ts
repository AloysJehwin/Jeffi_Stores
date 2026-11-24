import { NextRequest, NextResponse } from 'next/server'
import { outreachGuard, serverError } from '@controller/lib/outreach/guard'
import { syncSheetList, ImportError } from '@controller/lib/outreach/import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// POST → re-read the Sheet behind a list and upsert its rows (existing contacts keep their progress).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid list id' }, { status: 400 })
  try {
    return NextResponse.json(await syncSheetList(id, admin))
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status })
    return serverError(e)
  }
}
