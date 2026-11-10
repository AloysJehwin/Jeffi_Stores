import { Sk } from '@/components/admin/kit/skeleton'
import PortalBrandPanel from '@/components/portal/PortalBrandPanel'
import { CERT_PORTAL } from '@/lib/tenancy/portal-config'

export default function Loading() {
  const brand = CERT_PORTAL.brand
  return (
    <div className="min-h-screen flex flex-col bg-surface text-foreground" aria-busy="true" aria-label="Loading">
      <div className="flex-1 grid lg:grid-cols-2">
        <div className="hidden lg:grid">
          <PortalBrandPanel badge={brand.badge} heading={brand.heading} points={brand.points} footnote={brand.footnote} />
        </div>
        <main className="flex flex-col justify-center px-4 lg:px-8 xl:px-16 py-12">
          <div className="w-full mx-auto max-w-sm lg:text-center">
            <h1 className="text-2xl font-bold text-foreground">{CERT_PORTAL.signIn.heading}</h1>
            <p className="mt-2 text-sm text-foreground-secondary">{CERT_PORTAL.signIn.description}</p>
            <div className="mt-8 space-y-4">
              <Sk className="h-11 w-full rounded-xl" />
              <Sk className="h-11 w-full rounded-xl" />
              <Sk className="h-11 w-full rounded-xl" />
            </div>
            {CERT_PORTAL.signIn.footnote && <p className="mt-6 text-xs text-foreground-muted">{CERT_PORTAL.signIn.footnote}</p>}
          </div>
        </main>
      </div>
    </div>
  )
}
