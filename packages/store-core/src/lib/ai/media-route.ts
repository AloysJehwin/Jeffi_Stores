// Error mapping shared by the admin AI media routes and the public generate-image route.
import { NextResponse } from 'next/server'
import { AiWalletError } from './billing'
import { AiMediaError } from './media'

export const WALLET_TOP_UP_URL = '/admin/wallet'

/** AiWalletError -> 402 with the top-up details; AiMediaError keeps its status; anything else 500. */
export function aiMediaErrorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof AiWalletError) {
    return NextResponse.json(
      { error: err.message || 'Top up your wallet to use AI', balanceInr: err.balanceInr, neededInr: err.neededInr, topUpUrl: WALLET_TOP_UP_URL },
      { status: 402 }
    )
  }
  if (err instanceof AiMediaError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: (err as Error)?.message || fallback }, { status: 500 })
}
