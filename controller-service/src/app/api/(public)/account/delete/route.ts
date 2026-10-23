import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { getCookieDomain } from '@/lib/auth/cookie-domain'
import { checkAccountDeletion, deleteCustomerAccount } from '@/lib/account/delete-account'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// What would block deleting the signed-in customer's account, and how many orders are kept for tax.
export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await checkAccountDeletion(auth.userId))
}

// Deletes the signed-in customer's account. The body must carry confirm: "DELETE".
export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (body?.confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 })
  }
  try {
    const via = request.headers.get('x-jeffi-client') === 'mobile' ? 'app' : 'web'
    const reason = typeof body.reason === 'string' ? body.reason : null
    const result = await deleteCustomerAccount(auth.userId, { via, reason })
    if (!result.ok) {
      if ('blockers' in result) return NextResponse.json({ error: result.blockers[0].message, blockers: result.blockers }, { status: 409 })
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const res = NextResponse.json({ deleted: true })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    const domain = getCookieDomain()
    for (const name of ['user_sid', 'session_id']) {
      res.headers.append('Set-Cookie', `${name}=; ${flags}`)
      if (domain) res.headers.append('Set-Cookie', `${name}=; Domain=${domain}; ${flags}`)
    }
    return res
  } catch (err) {
    console.error('[account-delete]', err)
    return NextResponse.json({ error: 'Could not delete your account. Please try again or email support@jeffistores.in.' }, { status: 500 })
  }
}

