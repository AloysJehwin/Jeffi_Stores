import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { listFormSubmissions } from '@/lib/review-forms/submissions'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const status = searchParams.get('status')
  const limit = 50
  const offset = (page - 1) * limit

  const { submissions, total } = await listFormSubmissions(id, { status, limit, offset })
  return NextResponse.json({ submissions, total })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'review_forms:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { submissionId, status } = await request.json()
  if (!submissionId || !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await queryOne(
    `UPDATE review_form_submissions SET status = $1 WHERE id = $2 AND form_id = $3 RETURNING *`,
    [status, submissionId, id]
  )
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ submission: result })
}
