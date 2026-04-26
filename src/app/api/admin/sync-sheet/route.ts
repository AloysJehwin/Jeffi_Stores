import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { productId, secret } = await request.json()
  if (secret !== process.env.JWT_SECRET?.slice(0, 16)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { syncProductToSheet } = await import('@/lib/google-sheets')
    await syncProductToSheet(productId)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
