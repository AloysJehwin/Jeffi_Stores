import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryCount, queryOne } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const status = searchParams.get('status')
  const limit = 50
  const offset = (page - 1) * limit

  const conditions = ['rfs.form_id = $1']
  const params2: unknown[] = [params.id]
  let i = 2

  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    conditions.push(`rfs.status = $${i++}`)
    params2.push(status)
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  const [submissions, total] = await Promise.all([
    queryMany(
      `SELECT rfs.* FROM review_form_submissions rfs ${where} ORDER BY rfs.submitted_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params2, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM review_form_submissions rfs ${where}`, params2),
  ])

  return NextResponse.json({ submissions, total })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { submissionId, status } = await request.json()
  if (!submissionId || !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await queryOne(
    `UPDATE review_form_submissions SET status = $1 WHERE id = $2 AND form_id = $3 RETURNING *`,
    [status, submissionId, params.id]
  )
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ submission: result })
}
