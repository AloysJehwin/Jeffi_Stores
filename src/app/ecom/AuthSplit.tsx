import Link from 'next/link'
import OwnerAuthForm from './OwnerAuthForm'
import { CheckMark } from './Shapes'

// Full-page split auth layout: branded value panel (left) + form (right).
// Collapses to a single column on mobile with a compact brand header.
export default function AuthSplit({ mode }: { mode: 'signup' | 'signin' }) {
  const points = [
    'Your own branded storefront + admin',
    'Online & COD payments, settled for you',
    'Delhivery delivery + GST invoicing built in',
    'Live in minutes — no servers, no code',
  ]
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand / value panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-accent-600 to-primary-600 text-white p-12">
        <div aria-hidden className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:40px_40px]" />
        <Link href="/" className="relative flex items-center gap-2 font-bold text-lg">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur text-white">J</span>
          Jeffi Commerce
        </Link>
        <div className="relative">
          <h2 className="text-4xl font-extrabold leading-tight">Everything you need to sell online — in one place.</h2>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-white/90">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20"><CheckMark className="w-3 h-3 text-white" /></span>{p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Trusted plumbing for payments, delivery and compliance — so you just sell.</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 bg-surface">
        {/* mobile brand */}
        <Link href="/" className="lg:hidden flex items-center gap-2 font-bold text-foreground mb-8 self-center">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white text-sm">J</span>
          Jeffi Commerce
        </Link>
        <OwnerAuthForm mode={mode} />
      </div>
    </div>
  )
}
