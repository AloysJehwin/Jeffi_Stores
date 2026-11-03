'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { navFor } from './nav'
import TenantSwitcher from './TenantSwitcher'
import ConsoleFrame, { ConsoleBrand, ConsoleOwner } from './_components/ConsoleFrame'

interface TenantLite {
  slug: string
  display_name: string
  status: string
  service_types: string[]
}

interface Props {
  owner: { email: string; name: string | null }
  tenants: TenantLite[]
  current: TenantLite
  flags?: string[]
  children: React.ReactNode
}

export default function ConsoleShell({ owner, tenants, current, flags = [], children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [switching, setSwitching] = useState(false)
  const storeUrl = `https://${current.slug}.jeffistores.in`
  const groups = navFor(current.service_types)
  const hasStore = current.service_types.includes('store')

  async function switchTenant(slug: string) {
    if (slug === current.slug) return
    setSwitching(true)
    await fetch('/api/ecom/tenant/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => {})
    setSwitching(false)
    router.refresh()
  }

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href))

  const rail = (close: () => void) => (
    <div className="flex flex-col h-full">
      <ConsoleBrand />

      <TenantSwitcher items={tenants} value={current.slug} disabled={switching} onChange={switchTenant} />

      <nav className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1 py-1">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.title && (
              <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
                {g.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {g.items.map(item => {
                const active = isActive(item.href, item.exact)
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={active ? 'page' : undefined}
                      className={`ecom-focus flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
                        active
                          ? 'ecom-current font-semibold'
                          : 'text-foreground-secondary ecom-hover hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-6 pt-4 border-t border-border-default space-y-2">
        {hasStore && current.status === 'active' && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-full ecom-accent-bg text-white text-sm font-semibold"
          >
            Open store <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        <ConsoleOwner owner={owner} />
      </div>
    </div>
  )

  return (
    <ConsoleFrame rail={rail} title={current.display_name}>
      {children}
    </ConsoleFrame>
  )
}
