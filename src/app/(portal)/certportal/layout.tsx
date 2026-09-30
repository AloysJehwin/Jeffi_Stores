export const dynamic = 'force-dynamic'

// certificate.jeffistores.in surface. Storefront chrome is suppressed for /certportal by
// ConditionalLayout; this is a bare shell so the portal owns its full page.
export default function CertPortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface flex flex-col">{children}</div>
}
