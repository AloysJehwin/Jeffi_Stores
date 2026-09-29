'use client'

import { ShoppingBag, CreditCard, LayoutDashboard, Truck, FileText, BarChart3 } from 'lucide-react'
import type { ComponentType } from 'react'

interface Feature {
  chapter: number
  title: string
  copy: string
  icon: ComponentType<{ className?: string }>
}

const FEATURES: Feature[] = [
  { chapter: 0, title: 'Storefront', copy: 'A fast catalogue your customers enjoy browsing.', icon: ShoppingBag },
  { chapter: 3, title: 'Payments', copy: 'One-tap checkout with online and COD built in.', icon: CreditCard },
  { chapter: 4, title: 'Dashboard', copy: 'Sales land instantly as revenue you can see.', icon: LayoutDashboard },
  { chapter: 6, title: 'Delivery', copy: 'Generate shipments and track a live AWB.', icon: Truck },
  { chapter: 7, title: 'GST invoices', copy: 'Compliant invoices, done in a single click.', icon: FileText },
  { chapter: 4, title: 'Insights', copy: 'Revenue, orders and trends at a glance.', icon: BarChart3 },
]

function scrub(index: number) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ecom-demo-goto', { detail: { index } }))
  const stage = document.getElementById('demo-stage')
  if (stage) stage.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export default function LandingFeatures() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
      {FEATURES.map((f) => {
        const Icon = f.icon
        return (
          <button
            key={f.title}
            type="button"
            onClick={() => scrub(f.chapter)}
            className="ecom-clean group text-left rounded-2xl border border-border-default bg-surface-elevated p-5 hover:border-[color:var(--ecom-accent,#4f46e5)] hover:shadow-md transition"
          >
            <span className="ecom-accent-bg inline-flex w-9 h-9 items-center justify-center rounded-lg text-white">
              <Icon className="w-4.5 h-4.5" />
            </span>
            <h3 className="mt-3 text-base font-bold text-foreground">{f.title}</h3>
            <p className="mt-1 text-sm text-foreground-secondary">{f.copy}</p>
            <span className="ecom-accent-text mt-3 inline-block text-xs font-semibold">See it in the demo</span>
          </button>
        )
      })}
    </div>
  )
}
