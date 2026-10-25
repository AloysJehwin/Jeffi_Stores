import { NextRequest, NextResponse } from 'next/server'
import { detachDevice } from '@/lib/push/devices'

export const dynamic = 'force-dynamic'

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Sign-out: detach the user; the install stays registered as a guest. No auth needed (the session
// may already be gone) — knowing the token is enough, and the reply is the same either way.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const token = safeDecode((await params).token)
    if (token.length >= 20 && token.length <= 512) await detachDevice(token)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
