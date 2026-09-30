import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

// Status of a bulk product-image job (polled by the controls page while it runs).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'controls:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  const job = await queryOne<{
    id: string
    status: string
    operation: string
    total: number
    done: number
    skipped: number
    log_id: string | null
    error: string | null
  }>(`SELECT id, status, operation, total, done, skipped, log_id, error FROM bulk_image_jobs WHERE id = $1`, [id])
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json({ job })
}
