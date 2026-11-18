import { NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry/shared'

export const dynamic = 'force-dynamic'

// Ready when the control plane, where the sites live, answers. Redis only rate-limits the lead form.
export async function GET() {
  try {
    await Promise.race([
      controlPlanePool().query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout after 3000ms')), 3000)),
    ])
    return NextResponse.json({ status: 'ready', checks: { db: 'ok' } })
  } catch (e: any) {
    return NextResponse.json({ status: 'not_ready', checks: { db: `fail: ${e?.message || 'error'}` } }, { status: 503 })
  }
}
