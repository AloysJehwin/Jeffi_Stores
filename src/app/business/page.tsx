'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

export default function BusinessHomePage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <div className="bg-zinc-800 rounded-2xl p-6 text-white border border-zinc-700">
        <h1 className="text-2xl font-bold">Welcome back{user?.firstName ? `, ${user.firstName}` : ''}!</h1>
        <p className="text-zinc-400 mt-1 text-sm">Your business portal — browse products, manage quotes and orders.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/business/catalog"
            className="px-5 py-2.5 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors">
            Browse Catalog
          </Link>
          <Link href="/business/quotes/new"
            className="px-5 py-2.5 border border-zinc-600 text-zinc-200 text-sm font-semibold rounded-lg hover:bg-zinc-700 transition-colors">
            Submit RFQ
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Browse Products', desc: 'See your negotiated prices', href: '/business/catalog', cta: 'Go to Catalog' },
          { label: 'My Quotes', desc: 'Track RFQ status and responses', href: '/business/quotes', cta: 'View Quotes' },
          { label: 'My Orders', desc: 'View and track your orders', href: '/business/orders', cta: 'View Orders' },
        ].map(({ label, desc, href, cta }) => (
          <div key={href} className="bg-surface-elevated border border-border-default rounded-xl p-5 flex flex-col gap-3">
            <div>
              <p className="font-semibold text-foreground">{label}</p>
              <p className="text-sm text-foreground-muted mt-0.5">{desc}</p>
            </div>
            <Link href={href} className="text-sm font-medium text-accent-500 hover:text-accent-600 transition-colors mt-auto">
              {cta} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
