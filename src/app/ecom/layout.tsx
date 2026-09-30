import { cookies, headers } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import EcomNav from './EcomNav'
import EcomMain from './EcomMain'
import './ecom.css'

export const dynamic = 'force-dynamic'

// Layout for the ecom control-plane surface. Reads the owner session server-side
// and renders the custom ecom nav; the storefront Header/Footer are suppressed
// for /ecom by ConditionalLayout.
export default async function EcomLayout({ children }: { children: React.ReactNode }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  // Minimal signals from headers (server component can't use the request object directly).
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)

  return (
    <div className="ecom-scope min-h-screen bg-surface flex flex-col">
      <EcomNav owner={owner ? { email: owner.email, name: owner.name } : null} />
      <EcomMain>{children}</EcomMain>
    </div>
  )
}
