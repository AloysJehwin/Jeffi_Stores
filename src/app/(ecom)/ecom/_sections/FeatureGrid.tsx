import type { ComponentType } from 'react'
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
    <section className="w-full px-6 lg:px-12 py-16">
      <div className="text-center mb-10">
        <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">Everything included</p>
        <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">No add-ons, no surprises</h2>
        <p className="text-foreground-secondary mt-3 text-lg">Every capability below ships on day one.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
        {FEATURES.map(f => {
          const Icon = f.icon
          return (
            <div
              key={f.title}
              className="rounded-2xl border border-border-default bg-surface-elevated p-5 shadow-sm shadow-black/[0.03]"
            >
              <span className="ecom-accent-bg inline-flex w-10 h-10 items-center justify-center rounded-lg text-white">
                <Icon className="w-5 h-5" />
              </span>
              <h3 className="mt-3 text-base font-bold text-foreground">{f.title}</h3>
              <p className="mt-1 text-sm text-foreground-secondary">{f.copy}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
