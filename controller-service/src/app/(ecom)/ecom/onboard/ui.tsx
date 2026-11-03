import type { ReactNode } from 'react'

// The console's button, field and badge styles, shared by the onboarding pages (server and client).
export const primaryBtn =
  'ecom-accent-bg inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40'
export const secondaryBtn =
  'org-sand org-sand-hover inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-foreground transition-colors disabled:opacity-40'
export const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-foreground-secondary ecom-hover hover:text-foreground transition-colors disabled:opacity-40'

export const fieldInput =
  'w-full rounded-xl border border-border-default bg-surface px-3.5 py-2.5 text-[16px] sm:text-sm text-foreground placeholder:text-foreground-muted ecom-field'
export const fieldLabel = 'block text-sm font-medium text-foreground-secondary mb-1.5'

/** The console's in-page banner (as in the dashboard's review notice). */
export const noteCls = 'rounded-2xl px-5 py-3 text-sm'

const TONE = {
  sage: 'org-sage org-sage-text',
  peach: 'org-peach org-brown',
  red: 'bg-[#f2d4cd] text-[#8a2e1f]',
  muted: 'bg-surface-secondary text-foreground-muted',
}

export function Badge({ tone = 'muted', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE[tone]}`}>{children}</span>
}
