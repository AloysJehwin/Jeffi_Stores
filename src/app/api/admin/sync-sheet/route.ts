import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { productId } = await request.json()
  try {
    const { syncProductToSheet } = await import('@/lib/google-sheets')
    await syncProductToSheet(productId)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err), stack: err?.stack?.split('\n').slice(0,3) }, { status: 500 })
  }
}
