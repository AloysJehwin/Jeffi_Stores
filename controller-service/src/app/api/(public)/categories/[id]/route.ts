import { NextRequest, NextResponse } from 'next/server'
import { query, queryCount } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'categories:write')
    if (admin instanceof NextResponse) return admin

    const categoryId = id

    const productCount = await queryCount('SELECT COUNT(*) FROM products WHERE category_id = $1', [categoryId])

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${productCount} product(s) assigned to it.` },
        { status: 400 }
      )
    }

    const subCategoryCount = await queryCount('SELECT COUNT(*) FROM categories WHERE parent_category_id = $1', [
      categoryId,
    ])

    if (subCategoryCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${subCategoryCount} subcategory(ies).` },
        { status: 400 }
      )
    }

    await query('DELETE FROM categories WHERE id = $1', [categoryId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete category' }, { status: 500 })
  }
}
