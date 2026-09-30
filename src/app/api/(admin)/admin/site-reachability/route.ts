import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'

export const dynamic = 'force-dynamic'

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || 'jeffistores.in'
const PROBE_TIMEOUT_MS = 5000

function resolveTarget(param: string | null, fallback: string): string | null {
  if (!param) return fallback
  let parsed: URL
  try {
    parsed = new URL(param)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname
  if (host !== PLATFORM_DOMAIN && !host.endsWith(`.${PLATFORM_DOMAIN}`)) return null
  return parsed.toString()
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'dashboard:read')
  if (admin instanceof NextResponse) return admin

  const base = await storeBaseUrlAsync()
  const url = resolveTarget(request.nextUrl.searchParams.get('url'), base)
  if (!url) {
    return NextResponse.json({ error: 'Invalid or disallowed url' }, { status: 400 })
  }

  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const resp = await fetch(url, { redirect: 'manual', signal: ctrl.signal })
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    return NextResponse.json({ url, ok: resp.status > 0, status: resp.status, latencyMs })
  } catch (err: any) {
    const latencyMs = Date.now() - start
    return NextResponse.json({ url, ok: false, status: 0, latencyMs, error: err?.message || 'unreachable' })
  }
}
