import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { uploadConversions, ConversionUploadInProgressError } from '@/lib/google-ads/conversions/upload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// "Upload now" from the Conversions tab: one run of the 30-minute job. 409 while a run holds the lock.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  try {
    return NextResponse.json(await uploadConversions())
  } catch (e) {
    if (e instanceof ConversionUploadInProgressError) return NextResponse.json({ error: e.message }, { status: 409 })
    return NextResponse.json({ error: (e as Error)?.message || 'Upload failed' }, { status: 500 })
  }
}
