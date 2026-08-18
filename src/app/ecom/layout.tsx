import { cookies, headers } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/owner-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import EcomNav from './EcomNav'

export const dynamic = 'force-dynamic'

// Layout for the ecom control-plane surface. Reads the owner session server-side
// and renders the custom ecom nav; the storefront Header/Footer are suppressed
// for /ecom by ConditionalLayout.
export default async function EcomLayout({ children }: { children: React.ReactNode }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  // Minimal signals from headers (server component can't use the request object directly).
  const h = await headers()
  const signals = { userAgent: h.get('user-agent'), acceptLanguage: h.get('accept-language'), uaPlatform: h.get('sec-ch-ua-platform') }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)

  return (
    <div className="min-h-screen bg-surface-secondary flex flex-col">
      {/* EcomNav self-hides on /signin + /signup (client-reactive), so it always mounts here. */}
      <EcomNav owner={owner ? { email: owner.email, name: owner.name } : null} />
      <main className="flex-1">{children}</main>
    </div>
  )
}
