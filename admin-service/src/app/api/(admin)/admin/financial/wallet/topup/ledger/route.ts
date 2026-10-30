import { NextRequest, NextResponse } from 'next/server'
import { normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listWalletLedger } from '@/lib/admin/wallet-ledger'
import { WALLET_ENTITY } from '@/lib/filters/entities/wallet'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

// The wallet page's ledger: ?page= plus its filters and ?sort&dir. Under the topup prefix so it is reachable on
// delhivery:read like the page itself.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'delhivery:read')
  if (admin instanceof NextResponse) return admin
  const sp = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  try {
    return NextResponse.json({ page, ...(await listWalletLedger(normalizeQuery(WALLET_ENTITY, sp), page, PAGE_SIZE, sp)) })
  } catch (err) {
    console.error('[wallet/ledger]', err)
    return NextResponse.json({ error: 'Failed to load the ledger' }, { status: 500 })
  }
}
