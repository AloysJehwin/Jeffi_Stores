import { NextResponse } from 'next/server'
import { NO_APP_ERROR, storeHasApp } from '@/lib/site/app-surface'

/** 403 when a request names the app surface on a store with no mobile app; null otherwise (the check runs only for 'app'). */
export async function noAppDenial(...surfaces: unknown[]): Promise<NextResponse | null> {
  if (!surfaces.includes('app') || (await storeHasApp())) return null
  return NextResponse.json({ error: NO_APP_ERROR }, { status: 403 })
}
