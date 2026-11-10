import { Sk } from '@/components/admin/kit/skeleton'
import PortalTopNav from '@/components/portal/PortalTopNav'
import { CERT_PORTAL } from '@/lib/tenancy/portal-config'
import CertsLoading from './CertsLoading'

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-surface text-foreground">
      <PortalTopNav title={CERT_PORTAL.navTitle} homeHref={CERT_PORTAL.successHref} right={<Sk className="h-7 w-20 rounded-lg bg-white/20" />} />
      <main className="flex-1 w-full px-4 pt-5 pb-28 sm:px-8 sm:py-10">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-2xl font-bold text-foreground">Your certificates</h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            Download your admin certificate, then install it in your browser or system keychain. Each certificate can be
            downloaded once - save it and its password somewhere safe.
          </p>
          <CertsLoading />
        </div>
      </main>
    </div>
  )
}
