import { CheckMark } from '../ecom/Shapes'
import CertPortalSignIn from './CertPortalSignIn'

export const dynamic = 'force-dynamic'

// Split-screen sign-in, matching the ecom auth layout: branded value panel (left) + Google
// sign-in (right). Collapses to a single column on mobile. Full cert list + download is /certs,
// gated on the portal cookie by middleware.
export default function CertPortalPage() {
  const points = [
    'Download your admin certificate securely',
    'Sign in with the Google account you were invited on',
    'One-time download — no certificate is emailed',
    'Step-by-step install help included',
  ]
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand / value panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-accent-600 to-primary-600 text-white p-12">
        <div aria-hidden className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:40px_40px]" />
        <span className="relative flex items-center gap-2 font-bold text-lg">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur text-white">J</span>
          Certificate Portal
        </span>
        <div className="relative">
          <h2 className="text-4xl font-extrabold leading-tight">Your admin certificate, safely in your hands.</h2>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-white/90">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20"><CheckMark className="w-3 h-3 text-white" /></span>{p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Certificates are never sent by email — you download yours here, once.</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 bg-surface">
        <div className="w-full max-w-sm mx-auto text-center">
          <h1 className="text-2xl font-bold text-foreground">Admin Certificate Portal</h1>
          <p className="mt-3 text-sm text-foreground-secondary">
            Sign in with the Google account you were invited on to download your admin certificate.
          </p>
          <div className="mt-8">
            <CertPortalSignIn />
          </div>
          <p className="mt-6 text-xs text-foreground-muted">
            You can download a certificate once. Save it somewhere safe when you do.
          </p>
        </div>
      </div>
    </div>
  )
}
