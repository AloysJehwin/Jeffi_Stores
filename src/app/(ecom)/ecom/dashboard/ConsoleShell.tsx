'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X, LogOut, ExternalLink, ChevronDown } from 'lucide-react'
import { NAV_GROUPS } from './nav'

interface TenantLite {
  slug: string
  display_name: string
  status: string
}

interface Props {
  owner: { email: string; name: string | null }
  tenants: TenantLite[]
  current: TenantLite
  children: React.ReactNode
}

export default function ConsoleShell({ owner, tenants, current, children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const storeUrl = `https://${current.slug}.jeffistores.in`

  async function signOut() {
    await fetch('/api/ecom/auth/signout', { method: 'POST' }).catch(() => {})
    router.push('/')
    router.refresh()
  }

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

  const rail = (
    <div className="flex flex-col h-full">
      <Link href="/" className="flex items-center gap-2.5 px-2 mb-6">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--console-terracotta)] text-white font-display font-black text-sm">
          J
        </span>
        <span className="font-display font-black text-lg text-foreground leading-none">Jeffi Commerce</span>
      </Link>

      <div className="relative mb-6">
        <select
          value={current.slug}
          disabled={switching || tenants.length < 2}
          onChange={e => switchTenant(e.target.value)}
          className="w-full appearance-none rounded-xl border border-border-default bg-surface-elevated pl-3 pr-9 py-2.5 text-sm font-semibold text-foreground disabled:opacity-100"
        >
          {tenants.map(t => (
            <option key={t.slug} value={t.slug}>
              {t.display_name}
            </option>
          ))}
        </select>
        {tenants.length > 1 && (
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((g, gi) => (
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
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
                        active
                          ? 'bg-[var(--console-terracotta-soft)] text-[var(--console-terracotta-deep)] font-semibold'
                          : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'
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
        {current.status === 'active' && (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-full ecom-accent-bg text-white text-sm font-semibold"
          >
            Open store <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{owner.name || owner.email}</div>
            {owner.name && <div className="text-xs text-foreground-muted truncate">{owner.email}</div>}
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="p-2 rounded-full text-foreground-muted hover:bg-surface-secondary hover:text-foreground"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="ecom-console min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden lg:block sticky top-0 h-screen border-r border-border-default bg-surface p-5">{rail}</aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border-default bg-surface">
        <button onClick={() => setOpen(true)} className="p-2 -ml-2 rounded-full hover:bg-surface-secondary" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
        <span className="font-display font-black text-foreground truncate">{current.display_name}</span>
        <span className="w-9" />
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-surface p-5 shadow-2xl overflow-y-auto">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-surface-secondary"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {rail}
          </aside>
        </div>
      )}

      <main className="min-w-0 px-5 sm:px-8 lg:px-12 py-8 lg:py-10">{children}</main>
    </div>
  )
}
