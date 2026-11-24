import Link from 'next/link'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

// The operator and address as published in the legal pages (lib/legals/policies.ts, Grievance Redressal).
const OPERATOR = 'Jeffi Stores'
const ADDRESS = 'Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092'
const SUPPORT_EMAIL = 'support@jeffistores.in'

// /legal is served on this host by the storefront app, so these are plain links, not client-side routes.
const LEGAL: [string, string][] = [
  ['Privacy policy', '/legal/privacy-policy'],
  ['Terms & conditions', '/legal/terms-and-conditions'],
  ['Refund policy', '/legal/return-refund-policy'],
  ['Shipping policy', '/legal/shipping-policy'],
  ['Merchant agreement', '/legal/merchant-agreement'],
  ['Grievance redressal', '/legal/grievance-redressal'],
]

function phoneParts(raw: string | null | undefined): { label: string; tel: string } | null {
  const d = (raw || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
  if (d.length !== 10) return raw ? { label: raw, tel: raw.replace(/[^\d+]/g, '') } : null
  return { label: `+91 ${d.slice(0, 5)} ${d.slice(5)}`, tel: `+91${d}` }
}

export default async function EcomFooter() {
  const phone = phoneParts((await getStoreIdentity().catch(() => null))?.phone)
  const link = 'hover:text-foreground hover:underline'
  return (
    <footer className="border-t border-border-default/60 bg-surface text-sm text-foreground-secondary">
      <div className="w-full px-4 sm:px-6 lg:px-12 py-10 sm:py-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <div className="font-display font-black text-lg text-foreground">Jeffi Commerce</div>
          <p className="mt-2 max-w-xs">Online stores, Showcase sites and business messaging, run by {OPERATOR}.</p>
          <nav aria-label="Product" className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/pricing" className={link}>Pricing</Link>
            <Link href="/apps" className={link}>Apps</Link>
            <Link href="/signup" className={link}>Start your store</Link>
          </nav>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Contact</div>
          <ul className="mt-3 space-y-2">
            <li><a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a></li>
            {phone && <li><a href={`tel:${phone.tel}`} className={link}>{phone.label}</a></li>}
            <li>{OPERATOR}, {ADDRESS}</li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Policies</div>
          <ul className="mt-3 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-1">
            {LEGAL.map(([label, href]) => (
              <li key={href}><a href={href} className={link}>{label}</a></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="w-full px-4 sm:px-6 lg:px-12 py-5 border-t border-border-default/60 text-xs text-foreground-muted">
        © {new Date().getFullYear()} {OPERATOR}. All rights reserved.
      </div>
    </footer>
  )
}
