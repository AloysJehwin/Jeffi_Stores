import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { loadGoogleConversions } from '@/lib/google-ads/conversions/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Live from Google: conversion actions, the account's conversion-tracking settings and the
// offline upload diagnostics. Read-only.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  let ads
  try {
    ads = await googleAdsClientFor()
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Google Ads is not connected' }, { status: 409 })
  }
  return NextResponse.json(await loadGoogleConversions(ads))
}
