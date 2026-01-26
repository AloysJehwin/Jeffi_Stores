import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ products: [] })
    }

    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select(`
        id,
        name,
        slug,
        base_price,
        sale_price,
        product_images (
          image_url,
          thumbnail_url,
          is_primary
        )
      `)
      .eq('is_active', true)
      .ilike('name', `%${query}%`)
      .order('name', { ascending: true })
      .limit(5)

    if (error) {
      console.error('Search error:', error)
      return NextResponse.json({ products: [] }, { status: 500 })
    }

    return NextResponse.json({ products: products || [] })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json({ products: [] }, { status: 500 })
  }
}
