'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Library, LogOut, Package, Search, X } from 'lucide-react'

// Vault chrome: sticky top bar (store identity, Library, search, account menu). The search query is
// shared via context so the library grid filters client-side as the buyer types.

interface SearchCtx {
  query: string
  setQuery: (q: string) => void
}

const VaultSearchContext = createContext<SearchCtx>({ query: '', setQuery: () => {} })
export const useVaultSearch = () => useContext(VaultSearchContext)

export interface VaultShellProps {
  storeName: string
  logoUrl: string | null
  storeUrl: string
  buyer: { name: string | null; email: string | null } | null
  children: React.ReactNode
}

const isLibraryPath = (p: string | null) => p === '/library' || p === '/vault/library'

export default function VaultShell({ storeName, logoUrl, storeUrl, buyer, children }: VaultShellProps) {
  const [query, setQuery] = useState('')
  return (
    <VaultSearchContext.Provider value={{ query, setQuery }}>
      <div className="flex min-h-[100dvh] flex-col bg-neutral-950 text-neutral-100">
        <TopBar storeName={storeName} logoUrl={logoUrl} storeUrl={storeUrl} buyer={buyer} />
        <div className="flex-1 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
          {children}
        </div>
      </div>
    </VaultSearchContext.Provider>
  )
}

function TopBar({ storeName, logoUrl, storeUrl, buyer }: Omit<VaultShellProps, 'children'>) {
  const pathname = usePathname()
  const onLibrary = isLibraryPath(pathname)
  const [mobileSearch, setMobileSearch] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-neutral-950/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-neutral-950/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:h-16 sm:gap-6">
        <Link href="/library" className="flex min-w-0 items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <StoreMark storeName={storeName} logoUrl={logoUrl} />
          <span className="hidden min-w-0 truncate text-sm font-medium text-neutral-300 sm:block">{storeName}</span>
          <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300 ring-1 ring-inset ring-indigo-400/25">
            Vault
          </span>
        </Link>

        <nav className="hidden sm:block">
          <Link
            href="/library"
            aria-current={onLibrary ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              onLibrary ? 'bg-white/[0.08] text-white' : 'text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100'
            }`}
          >
            <Library className="h-4 w-4" aria-hidden />
            Library
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden w-64 md:block lg:w-80">
            <SearchBox />
          </div>
          <button
            type="button"
            onClick={() => setMobileSearch(v => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-300 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 md:hidden"
            aria-label={mobileSearch ? 'Close search' : 'Search library'}
            aria-expanded={mobileSearch}
          >
            {mobileSearch ? <X className="h-5 w-5" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
          </button>
          <AccountMenu buyer={buyer} storeUrl={storeUrl} />
        </div>
      </div>
      {mobileSearch ? (
        <div className="border-t border-white/[0.06] px-[max(1rem,env(safe-area-inset-left))] py-2 md:hidden">
          <SearchBox autoFocus />
        </div>
      ) : null}
    </header>
  )
}

function StoreMark({ storeName, logoUrl }: { storeName: string; logoUrl: string | null }) {
  const [broken, setBroken] = useState(false)
  if (logoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={storeName}
        onError={() => setBroken(true)}
        className="h-8 w-8 shrink-0 rounded-lg bg-white/5 object-contain"
        draggable={false}
      />
    )
  }
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
      {(storeName.trim()[0] || 'V').toUpperCase()}
    </span>
  )
}

export function SearchBox({ autoFocus }: { autoFocus?: boolean }) {
  const { query, setQuery } = useVaultSearch()
  const pathname = usePathname()
  const router = useRouter()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Search lives on the library; from an item page, take the query there.
    if (!isLibraryPath(pathname)) router.push(`/library${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
  }

  return (
    <form role="search" onSubmit={onSubmit} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus={autoFocus}
        placeholder="Search your library"
        aria-label="Search your library"
        className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
      />
    </form>
  )
}

function AccountMenu({ buyer, storeUrl }: { buyer: VaultShellProps['buyer']; storeUrl: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const label = buyer?.name || buyer?.email || 'Account'
  const initial = (label.trim()[0] || '?').toUpperCase()
  const store = storeUrl.replace(/\/$/, '')

  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const signOut = async () => {
    setBusy(true)
    let to = store || '/'
    try {
      const r = await fetch('/api/vault/logout', { method: 'POST', credentials: 'same-origin' })
      const j = (await r.json().catch(() => null)) as { redirect?: string } | null
      if (j?.redirect) to = j.redirect
    } catch {
      // Fall through to the store; the cookie may still be cleared on the next vault visit.
    }
    window.location.assign(to)
  }

  const items = (
    <>
      <div className="border-b border-white/[0.06] px-4 py-3">
        {buyer?.name ? <p className="truncate text-sm font-medium text-white">{buyer.name}</p> : null}
        {buyer?.email ? <p className="truncate text-xs text-neutral-400">{buyer.email}</p> : null}
        {!buyer ? <p className="text-sm text-neutral-400">Not signed in</p> : null}
      </div>
      <div className="p-1.5">
        <MenuLink href={store || '/'} icon={<ArrowLeft className="h-4 w-4" aria-hidden />}>Back to store</MenuLink>
        <MenuLink href={`${store}/account/orders`} icon={<Package className="h-4 w-4" aria-hidden />}>My orders</MenuLink>
        {buyer ? (
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-rose-300 hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        ) : null}
      </div>
    </>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-neutral-700 to-neutral-800 text-sm font-semibold text-white ring-1 ring-white/10 transition hover:ring-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        {initial}
      </button>
      {open ? (
        <>
          {/* Desktop: dropdown. */}
          <div role="menu" className="absolute right-0 top-11 hidden w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-neutral-900/95 shadow-2xl shadow-black/50 backdrop-blur-xl sm:block">
            {items}
          </div>
          {/* Mobile: bottom sheet. */}
          <div className="fixed inset-0 z-[60] sm:hidden">
            <button type="button" aria-label="Close menu" onClick={close} className="absolute inset-0 bg-black/60" />
            <div role="menu" className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-2xl border-t border-white/[0.08] bg-neutral-900 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15" aria-hidden />
              {items}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      role="menuitem"
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-200 hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none"
    >
      {icon}
      {children}
    </a>
  )
}
