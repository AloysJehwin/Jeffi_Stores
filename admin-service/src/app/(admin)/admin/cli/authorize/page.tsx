import { headers } from 'next/headers'
import { findPendingDevice, TOKEN_TTLS } from '@/lib/auth/api-tokens'
import AuthorizeClient from './AuthorizeClient'

export const dynamic = 'force-dynamic'

// The browser half of `jeffi login`: confirm the code the terminal shows, pick scopes and a lifetime.
export default async function CliAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const code = typeof sp.code === 'string' ? sp.code : ''
  const pending = code ? await findPendingDevice(code, h.get('x-tenant-id')).catch(() => null) : null
  const scopeHint = typeof sp.scope === 'string' ? sp.scope : ''
  const ttlHint = typeof sp.ttl === 'string' && sp.ttl in TOKEN_TTLS ? sp.ttl : ''
  return (
    <AuthorizeClient
      initialCode={pending?.userCode ?? code}
      pending={pending}
      administrator={role === 'administrator'}
      scopeHint={scopeHint === 'read' || scopeHint === 'all' ? scopeHint : scopeHint ? 'custom' : ''}
      customScopes={scopeHint && scopeHint !== 'read' && scopeHint !== 'all' ? scopeHint : ''}
      ttlHint={ttlHint}
    />
  )
}
