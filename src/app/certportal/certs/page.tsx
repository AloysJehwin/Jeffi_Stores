import CertList from './CertList'

export const dynamic = 'force-dynamic'

// Signed-in cert list + one-time download + install help. Middleware gates this path on the portal
// cookie, so an unauthenticated visitor is redirected to / before reaching here.
export default function CertsPage() {
  return (
    <main className="flex-1 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground">Your certificates</h1>
        <p className="mt-2 text-sm text-foreground-secondary">
          Download your admin certificate, then install it in your browser or system keychain. Each
          certificate can be downloaded once — save it and its password somewhere safe.
        </p>
        <CertList />
      </div>
    </main>
  )
}
