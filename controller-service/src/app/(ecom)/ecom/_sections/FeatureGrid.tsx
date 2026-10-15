import type { ComponentType } from 'react'
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

export default function FeatureGrid() {
  return (
    <section className="w-full px-6 lg:px-12 py-20">
      <Eyebrow>Everything included</Eyebrow>
      <Display className="mt-3 text-4xl lg:text-5xl max-w-xl">No add-ons, no surprises</Display>
      <p className="text-foreground-secondary mt-4 text-lg">Every capability below ships on day one.</p>
      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
        {FEATURES.map(f => (
          <SandCard key={f.title}>
            <Dot tone="terracotta" />
            <h3 className="font-display font-black text-xl text-foreground mt-5">{f.title}</h3>
            <p className="mt-2 text-base text-foreground-secondary leading-relaxed">{f.copy}</p>
          </SandCard>
        ))}
      </div>
    </section>
  )
}
