import Link from 'next/link'
import type { ReactNode } from 'react'

// Shared sign-in / sign-up layout (the ecom AuthSplit pattern): a themed brand panel beside the form on
// desktop; on phones a compact brand header, the form, then the value points. No top nav on auth pages.

export interface AuthPanelTheme {
  /** Brand panel background and text colour. */
  panel: string
  /** Logo chip on the panel. */
  chip: string
  /** Check marks beside the points. */
  check: string
  /** Logo chip in the phone header and the phone value card's check marks. */
  accent: string
}

export interface AuthSplitShellProps {
  brandName: string
  logoUrl?: string | null
  homeHref?: string
  headline: string
  sub?: string
  points: string[]
  footnote?: string
  theme: AuthPanelTheme
  /** Corner action, e.g. the "Sign up" switch. */
  corner?: ReactNode
  /** Full-page "signing you in" overlay while a sign-in completes or the next page loads. */
  busy?: string | null
  children: ReactNode
}

function Mark({ brandName, logoUrl, cls }: { brandName: string; logoUrl?: string | null; cls: string }) {
  if (logoUrl) {
    return (
      <span className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" className="h-6 w-auto max-w-[7rem] object-contain" />
      </span>
    )
  }
  return (
    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${cls}`}>
      {brandName.trim().charAt(0).toUpperCase() || 'J'}
    </span>
  )
}

function Check({ cls }: { cls: string }) {
  return (
    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  )
}

export function AuthBusyOverlay({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface/80 backdrop-blur-sm"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      <p className="text-sm font-medium text-foreground">{text}</p>
    </div>
  )
}

export default function AuthSplitShell({
  brandName,
  logoUrl,
  homeHref = '/',
  headline,
  sub,
  points,
  footnote,
  theme,
  corner,
  busy,
  children,
}: AuthSplitShellProps) {
  return (
    <div className="relative grid min-h-[100dvh] grid-cols-1 bg-surface lg:grid-cols-2">
      {corner && (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-3 sm:right-6 sm:top-6">{corner}</div>
      )}

      <aside className={`relative hidden flex-col justify-between overflow-hidden p-12 lg:flex ${theme.panel}`}>
        <div aria-hidden className="absolute -bottom-32 -right-32 h-[420px] w-[420px] rounded-full bg-white/10" />
        <div aria-hidden className="absolute -left-16 top-24 h-40 w-40 rounded-full bg-white/10" />
        <Link href={homeHref} className="relative flex items-center gap-3 text-xl font-black">
          <Mark brandName={brandName} logoUrl={logoUrl} cls={theme.chip} />
          <span className="min-w-0 truncate">{brandName}</span>
        </Link>
        <div className="relative max-w-lg">
          <h2 className="text-4xl font-black leading-[1.1] xl:text-5xl">{headline}</h2>
          {sub && <p className="mt-4 text-base leading-relaxed opacity-80">{sub}</p>}
          <ul className="mt-8 space-y-3">
            {points.map(p => (
              <li key={p} className="flex items-start gap-3 opacity-90">
                <Check cls={theme.check} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-70">{footnote}</p>
      </aside>

      <main className="flex min-w-0 flex-col justify-center px-4 pb-10 pt-20 sm:px-12 sm:py-16">
        <Link
          href={homeHref}
          className="mb-8 flex items-center gap-2 self-center text-xl font-black text-foreground lg:hidden"
        >
          <Mark brandName={brandName} logoUrl={logoUrl} cls={theme.accent} />
          <span className="min-w-0 truncate">{brandName}</span>
        </Link>
        <div className="mx-auto w-full max-w-sm">{children}</div>
        <div className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-border-default bg-surface-elevated p-5 lg:hidden">
          <p className="text-base font-bold leading-snug text-foreground">{headline}</p>
          <ul className="mt-3 space-y-2.5">
            {points.map(p => (
              <li key={p} className="flex items-start gap-3 text-sm text-foreground-secondary">
                <Check cls={theme.accent} />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>

      {busy && <AuthBusyOverlay text={busy} />}
    </div>
  )
}

export const AUTH_THEMES = {
  store: {
    panel: 'bg-gradient-to-br from-accent-600 to-accent-800 text-white',
    chip: 'bg-white/20 text-white',
    check: 'bg-white/20 text-white',
    accent: 'bg-accent-500/15 text-accent-600 dark:text-accent-400',
  },
  business: {
    panel: 'bg-gradient-to-br from-secondary-600 to-secondary-800 text-white',
    chip: 'bg-white/15 text-white',
    check: 'bg-white/15 text-accent-300',
    accent: 'bg-secondary-500/15 text-secondary-600 dark:text-secondary-300',
  },
  admin: {
    panel: 'bg-gradient-to-br from-zinc-900 via-secondary-800 to-secondary-700 text-white',
    chip: 'bg-accent-500 text-white',
    check: 'bg-accent-500/25 text-accent-300',
    accent: 'bg-accent-500/15 text-accent-600 dark:text-accent-400',
  },
} satisfies Record<string, AuthPanelTheme>

export const AUTH_POINTS = {
  store: [
    'Track orders, invoices and returns',
    'Saved addresses for a faster checkout',
    'Wishlist, rewards and member offers',
  ],
  business: [
    'Custom discount rates on your categories',
    'Request for Quote (RFQ) on any product',
    'Dedicated support for bulk orders',
    'Full order history and GST invoices',
  ],
  admin: [
    'Orders, inventory and invoicing in one place',
    'Customers, campaigns and reports',
    'Signed-in devices and certificates you control',
  ],
}
