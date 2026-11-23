import type { ComponentType } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Eyebrow, Display, SandCard, Dot } from '../_ui'
import {
  ShoppingBag,
  LayoutDashboard,
  CreditCard,
  Truck,
  FileText,
  Boxes,
  Users,
  Megaphone,
  Building2,
} from 'lucide-react'

interface Feature {
  title: string
  copy: string
  icon: ComponentType<{ className?: string }>
}

const FEATURES: Feature[] = [
  { title: 'Storefront', copy: 'A fast, mobile-first catalogue on your own subdomain.', icon: ShoppingBag },
  { title: 'One admin', copy: 'Run the whole business from a single dashboard.', icon: LayoutDashboard },
  { title: 'Payments (online + COD)', copy: 'Captured to settled, reconciled for you.', icon: CreditCard },
  { title: 'Delhivery delivery', copy: 'Create shipments and track live AWBs.', icon: Truck },
  { title: 'GST invoicing', copy: 'CGST/SGST/IGST invoices, GSTR-ready.', icon: FileText },
  { title: 'Inventory', copy: 'Stock levels, low-stock alerts, batches and serials.', icon: Boxes },
  { title: 'CRM', copy: 'Customer health, segments and lifetime value.', icon: Users },
  { title: 'Campaigns', copy: 'Triggered email and WhatsApp journeys.', icon: Megaphone },
  { title: 'B2B portal', copy: 'Approve business accounts with GST and pricing.', icon: Building2 },
]

// An odd last card spans the two-column (sm) row instead of sitting alone.
const lastSpan = FEATURES.length % 2 === 1 ? 'sm:col-span-2 lg:col-span-1' : ''

export default function FeatureGrid() {
  return (
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>Built in</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-xl">The essentials, in one place</Display>
      <p className="text-foreground-secondary mt-4 text-base sm:text-lg max-w-2xl">
        Every plan includes the storefront and admin; higher plans add more of what&apos;s below.{' '}
        <Link href="/pricing" className="org-brown font-semibold hover:underline">Compare plans</Link>
      </p>
      <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5 w-full">
        {FEATURES.map((f, i) => (
          <SandCard
            key={f.title}
            className={clsx('max-sm:flex max-sm:items-start max-sm:gap-4 max-sm:rounded-3xl max-sm:p-5', i === FEATURES.length - 1 && lastSpan)}
          >
            <Dot tone="terracotta" className="max-sm:mt-1.5 max-sm:shrink-0" />
            <div className="min-w-0">
              <h3 className="font-display font-black text-xl text-foreground sm:mt-5">{f.title}</h3>
              <p className="mt-1 sm:mt-2 text-base text-foreground-secondary leading-relaxed">{f.copy}</p>
            </div>
          </SandCard>
        ))}
      </div>
    </section>
  )
}
