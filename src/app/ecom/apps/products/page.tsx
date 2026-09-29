import Link from 'next/link'
import { Package, Check } from 'lucide-react'
import ProductsDemo from './ProductsDemo'

export const dynamic = 'force-dynamic'

const BENEFITS = [
  'Variants and sub-variants with their own SKU, price, MRP and stock.',
  'GST-ready pricing: HSN code, tax rate and inclusive or exclusive prices.',
  'Draft now, publish when ready — nothing goes live until you say so.',
  'Multiple images per product and per variant, on desktop and mobile.',
]

export default function ProductsAppPage() {
  return (
    <div className="ecom-clean bg-[#eef1f5] text-foreground">
      <section className="w-full px-6 lg:px-12 pt-10 pb-16 sm:pt-14 max-w-6xl mx-auto">
        <nav className="text-sm text-foreground-muted mb-8">
          <Link href="/apps" className="hover:text-foreground">Apps</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground-secondary">Catalogue</span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          <span className="ecom-accent-bg shrink-0 grid place-items-center w-16 h-16 rounded-2xl text-white">
            <Package className="w-8 h-8" />
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground">Products &amp; variants</h1>
            <p className="mt-3 text-lg text-foreground-secondary max-w-2xl">
              Rich product pages with variants, images and stock — created in a draft, published in one click.
            </p>
          </div>
        </div>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2 max-w-3xl">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-3">
              <span className="ecom-accent-text shrink-0 mt-0.5"><Check className="w-5 h-5" /></span>
              <span className="text-foreground-secondary">{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10 rounded-2xl bg-surface-elevated border border-border-default shadow-xl shadow-black/[0.06] p-3 sm:p-4">
          <ProductsDemo />
        </div>

        <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Link href="/signup" className="ecom-accent-bg w-full sm:w-auto text-center px-7 py-3.5 rounded-lg text-white font-semibold">Start your store</Link>
          <Link href="/apps" className="w-full sm:w-auto text-center px-7 py-3.5 rounded-lg font-semibold text-foreground bg-surface border border-border-default hover:bg-surface-secondary">All apps</Link>
        </div>
      </section>
    </div>
  )
}
