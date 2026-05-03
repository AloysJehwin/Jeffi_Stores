import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await queryOne('SELECT * FROM review_forms WHERE id = $1', [params.id])
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ form })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const fields = ['title', 'slug', 'description', 'google_review_url', 'coupon_id', 'is_active', 'custom_fields']
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  for (const field of fields) {
    if (field in body) {
      updates.push(`${field} = $${i++}`)
      if (field === 'slug') values.push((body[field] as string).toLowerCase().trim())
      else if (field === 'custom_fields') values.push(JSON.stringify(body[field]))
      else values.push(body[field])
    }
  }

  if (!updates.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  values.push(params.id)
  const result = await queryMany(`UPDATE review_forms SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values)
  if (!result.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ form: result[0] })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await queryOne('DELETE FROM review_forms WHERE id = $1', [params.id])
  return NextResponse.json({ success: true })
}
