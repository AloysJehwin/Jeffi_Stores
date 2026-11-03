'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu, X, LogOut } from 'lucide-react'

export function ConsoleBrand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2 mb-6">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--console-terracotta)] text-white font-display font-black text-sm">
        J
      </span>
      <span className="font-display font-black text-lg text-foreground leading-none">Jeffi Commerce</span>
    </Link>
  )
}

export function ConsoleOwner({ owner }: { owner: { email: string; name: string | null } }) {
  const router = useRouter()

  async function signOut() {
    await fetch('/api/ecom/auth/signout', { method: 'POST' }).catch(() => {})
    router.push('/')
    router.refresh()
  }

  return (
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
  )
}

/** The console layout: a sticky rail on desktop, a top bar + drawer below lg. `rail` gets a close() for the drawer. */
export default function ConsoleFrame({
  rail,
  title,
  trailing = <span className="w-9" />,
  topBarExtra,
  children,
}: {
  rail: (close: () => void) => ReactNode
  title: ReactNode
  trailing?: ReactNode
  /** Rendered inside the mobile top bar, e.g. an absolutely positioned progress strip. */
  topBarExtra?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="ecom-console min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden lg:block sticky top-0 h-screen border-r border-border-default bg-surface p-5">{rail(close)}</aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border-default bg-surface">
        <button onClick={() => setOpen(true)} className="p-2 -ml-2 rounded-full hover:bg-surface-secondary" aria-label="Open menu">
          <Menu className="w-5 h-5" />
        </button>
        <span className="font-display font-black text-foreground truncate">{title}</span>
        {trailing}
        {topBarExtra}
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-foreground/30" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-surface p-5 shadow-2xl overflow-y-auto">
            <button
              onClick={close}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-surface-secondary"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            {rail(close)}
          </aside>
        </div>
      )}

      <main className="min-w-0 px-5 sm:px-8 lg:px-12 py-8 lg:py-10">{children}</main>
    </div>
  )
}
