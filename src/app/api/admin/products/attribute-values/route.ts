import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Allowed fields to prevent SQL injection
const ALLOWED_FIELDS: Record<string, string> = {
  grade: 'grade',
  compliance_standard: 'compliance_standard',
  safety_rating: 'safety_rating',
  country_of_origin: 'country_of_origin',
  brand_part_number: 'brand_part_number',
  shipping_class: 'shipping_class',
  condition: 'condition',
  tax_class: 'tax_class',
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const field = searchParams.get('field') || ''
  const search = searchParams.get('search') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const col = ALLOWED_FIELDS[field]
  if (!col) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })

  const searchClause = search ? `AND ${col} ILIKE $3` : ''
  const params: unknown[] = search
    ? [`%${search}%`, limit, `%${search}%`, offset]
    : [limit, offset]

  // For certifications (text array), unnest
  if (field === 'certifications') {
    const rows = await queryMany<{ value: string; count: number }>(
      `SELECT unnest(certifications) AS value, COUNT(*) AS count
       FROM products WHERE certifications IS NOT NULL AND cardinality(certifications) > 0
       ${search ? `AND EXISTS (SELECT 1 FROM unnest(certifications) c WHERE c ILIKE $1)` : ''}
       GROUP BY value ORDER BY count DESC, value LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`,
      search ? [`%${search}%`, limit, offset] : [limit, offset]
    )
    return NextResponse.json({ values: rows, field })
  }

  const rows = await queryMany<{ value: string; count: number }>(
    `SELECT ${col} AS value, COUNT(*)::int AS count
     FROM products
     WHERE ${col} IS NOT NULL AND ${col} != ''
     ${search ? `AND ${col} ILIKE $1` : ''}
     GROUP BY ${col}
     ORDER BY count DESC, ${col}
     LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`,
    search ? [`%${search}%`, limit, offset] : [limit, offset]
  )

  return NextResponse.json({ values: rows, field })
}
