import { NextRequest, NextResponse } from 'next/server'
import { query, queryCount } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const categoryId = params.id

    // Check if category has products
    const productCount = await queryCount(
      'SELECT COUNT(*) FROM products WHERE category_id = $1',
      [categoryId]
    )

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${productCount} product(s) assigned to it.` },
        { status: 400 }
      )
    }

    // Check if category has subcategories
    const subCategoryCount = await queryCount(
      'SELECT COUNT(*) FROM categories WHERE parent_category_id = $1',
      [categoryId]
    )

    if (subCategoryCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${subCategoryCount} subcategory(ies).` },
        { status: 400 }
      )
    }

    // Delete category
    await query('DELETE FROM categories WHERE id = $1', [categoryId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete category' },
      { status: 500 }
    )
  }
}
