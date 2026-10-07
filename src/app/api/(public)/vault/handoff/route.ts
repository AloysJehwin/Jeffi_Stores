import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, authenticateBusiness } from '@/lib/auth/jwt'
import { isValidState, mintVaultTicket, safeTargetPath, type TicketPrincipal } from '@/lib/vault/sso'
import { vaultBaseUrlAsync } from '@/lib/vault/links'

// Store host: mint a single-use ticket for the signed-in buyer and 302 to the vault callback.
export const dynamic = 'force-dynamic'

// Local dev has no platform DNS: keep the request's own host/port under a `vault.` label.
async function vaultBase(request: NextRequest): Promise<string> {
  const host = request.headers.get('host') || request.nextUrl.host
  if (process.env.NODE_ENV !== 'production' && /^(?:[^.]+\.)?localhost(?::\d+)?$/i.test(host)) {
    return `${request.nextUrl.protocol}//vault.${host.replace(/^[^.]+\.(?=localhost)/i, '')}`
  }
  return vaultBaseUrlAsync()
}

export async function GET(request: NextRequest) {
  const customer = await authenticateUser(request)
  const business = customer ? null : await authenticateBusiness(request)
  const principal: TicketPrincipal | null = customer ? 'customer' : business ? 'business' : null
  const userId = customer?.userId ?? business?.userId
  const targetPath = safeTargetPath(request.nextUrl.searchParams.get('target'))
  const state = request.nextUrl.searchParams.get('state')

  // No state means this handoff didn't start on the vault host (e.g. a crafted link). Send the
  // browser there first; it sets its own vault_state cookie and bounces back with it.
  if (!isValidState(state)) {
    const res = NextResponse.redirect(new URL(targetPath, await vaultBase(request)))
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  if (!principal || !userId) {
    const back = `/api/vault/handoff?target=${encodeURIComponent(targetPath)}&state=${state}`
    const res = NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(back)}`, request.url))
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  const { token } = await mintVaultTicket({ userId, principalType: principal, targetPath, state })
  const callback = new URL('/callback', await vaultBase(request))
  callback.searchParams.set('t', token)
  const res = NextResponse.redirect(callback)
  res.headers.set('Cache-Control', 'no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
