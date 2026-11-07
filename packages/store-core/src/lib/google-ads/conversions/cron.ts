import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { googleAdsEnvStatus, resolveGoogleAdsCreds } from '../credentials'
import { uploadConversions, ConversionUploadInProgressError } from './upload'

/** Cron entry (per store via the fan-out). */
export async function handleConversionsCron(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let creds: Awaited<ReturnType<typeof resolveGoogleAdsCreds>> | undefined
  try {
    creds = await resolveGoogleAdsCreds()
  } catch {
    return NextResponse.json({ skipped: 'not_connected' })
  }
  // The store's own developer token, else the platform's.
  if (!creds?.developerToken && !googleAdsEnvStatus().developerToken) return NextResponse.json({ skipped: 'not_configured' })
  try {
    const r = await uploadConversions()
    return NextResponse.json({ status: r.status, uploaded: r.uploaded, failed: r.failed, retrying: r.retrying, skipped: r.skipped })
  } catch (e) {
    if (e instanceof ConversionUploadInProgressError) return NextResponse.json({ skipped: 'running' })
    return NextResponse.json({ error: (e as Error)?.message || 'Upload failed' }, { status: 500 })
  }
}
