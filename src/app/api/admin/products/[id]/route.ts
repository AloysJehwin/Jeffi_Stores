import { NextRequest, NextResponse } from 'next/server'
import { getProduct } from '@/lib/queries'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const product = await getProduct(params.id)
    return NextResponse.json(product)
  } catch (err: any) {
    if (err.message === 'Product not found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
