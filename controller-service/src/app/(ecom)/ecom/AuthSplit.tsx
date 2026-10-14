import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import OwnerAuthForm from './OwnerAuthForm'
import { CheckMark } from './Shapes'

// Full-page split auth layout: branded value panel (left) + form (right).
// Collapses to a single column on mobile with a compact brand header.
// Server-guarded: an already-signed-in owner is bounced to the dashboard so the
// auth form is never shown to an authenticated session.
export default async function AuthSplit({ mode }: { mode: 'signup' | 'signin' }) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const h = await headers()
  const signals = {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  }
  const owner = await resolveOwnerSession(sid, signals as any).catch(() => null)
  if (owner) redirect('/dashboard')
  const points = [
    'Your own branded storefront + admin',
    'Online & COD payments, settled for you',
    'Delhivery delivery + GST invoicing built in',
    'Live in minutes — no servers, no code',
  ]
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand / value panel */}
      <div className="ecom-accent-bg relative hidden lg:flex flex-col justify-between overflow-hidden text-white p-12">
        <div aria-hidden className="org-sage absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full opacity-60" />
        <div aria-hidden className="org-peach absolute top-24 -left-16 w-40 h-40 rounded-full opacity-50" />
        <Link href="/" className="relative flex items-center gap-2 font-display font-black text-xl">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20 text-white">
            J
          </span>
          Jeffi Commerce
        </Link>
        <div className="relative">
          <h2 className="font-display font-black text-4xl xl:text-5xl leading-[1.05]">Everything you need to sell online — in one place.</h2>
          <ul className="mt-8 space-y-3">
            {points.map(p => (
              <li key={p} className="flex items-center gap-3 text-white/90">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20">
                  <CheckMark className="w-3 h-3 text-white" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">
          Trusted plumbing for payments, delivery and compliance — so you just sell.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 bg-surface">
        {/* mobile brand */}
        <Link href="/" className="lg:hidden flex items-center gap-2 font-display font-black text-xl text-foreground mb-8 self-center">
          <span className="ecom-accent-bg inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-display font-black">
            J
          </span>
          Jeffi Commerce
        </Link>
        <OwnerAuthForm mode={mode} />
      </div>
    </div>
  )
}
