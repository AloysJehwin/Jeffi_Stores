import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const categoryId = params.id

    // Check if category has products
    const { count: productCount } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId)

    if (productCount && productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${productCount} product(s) assigned to it.` },
        { status: 400 }
      )
    }

    // Check if category has subcategories
    const { count: subCategoryCount } = await supabaseAdmin
      .from('categories')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', categoryId)

    if (subCategoryCount && subCategoryCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${subCategoryCount} subcategory(ies).` },
        { status: 400 }
      )
    }

    // Delete category
    const { error } = await supabaseAdmin
      .from('categories')
      .delete()
      .eq('id', categoryId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete category' },
      { status: 500 }
    )
  }
}
