import type { ShowcaseConsoleState } from './state'
import { showcaseMonthly } from '@/lib/showcase/offer'

// Where one site's hosting stands, from its billing line (client-safe: the sites list and the site page).

export type HostingKind = 'draft' | 'trial' | 'trial_autopay' | 'approve' | 'active' | 'ending' | 'halted' | 'legacy' | 'lapsed' | 'unbilled'

export interface HostingView {
  kind: HostingKind
  label: string
  detail: string | null
  tone: 'ok' | 'warn' | 'muted'
}

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** Trial ended, hosting lapsed, or the subscription halted: the owner chooses Showcase or a store (KeepOnline). */
export const needsKeepOnline = (s: ShowcaseConsoleState) => ['lapsed', 'halted'].includes(hostingView(s).kind)

export function hostingView(s: ShowcaseConsoleState): HostingView {
  const until = (iso: string | null, word: string) => (iso ? `${word} until ${fmtDay(iso)}` : word)
  if (s.status === 'draft') return { kind: 'draft', label: 'Not published', detail: null, tone: 'muted' }
  if (s.lineStatus === 'legacy_wallet')
    return { kind: 'legacy', label: 'Move to your subscription', detail: s.graceUntil ? `Goes offline on ${fmtDay(s.graceUntil)} unless moved` : null, tone: 'warn' }
  if (s.subscriptionStatus === 'halted' && (s.lineStatus === 'active' || s.lineStatus === 'ending'))
    return { kind: 'halted', label: 'Payment failed', detail: s.graceUntil ? `Goes offline on ${fmtDay(s.graceUntil)} unless paid` : 'Pay to keep it online', tone: 'warn' }
  if (s.lapsed && !s.autopay)
    return { kind: 'lapsed', label: s.lineStatus === 'trial' ? 'Free trial ended' : 'Hosting unpaid', detail: s.status === 'paused' ? 'Offline until it is paid' : null, tone: 'warn' }
  if (s.checkoutUrl) return { kind: 'approve', label: s.free ? until(s.trialEndsAt, 'Free') : 'Autopay not approved', detail: 'Approve autopay to keep it online', tone: 'warn' }
  if (s.lineStatus === 'ending') return { kind: 'ending', label: until(s.endsAt, 'Online'), detail: 'Autopay off', tone: 'warn' }
  if (s.free)
    return s.autopay
      ? { kind: 'trial_autopay', label: until(s.trialEndsAt, 'Free'), detail: `Autopay set · ${showcaseMonthly(s.priceInr)} after`, tone: 'ok' }
      : { kind: 'trial', label: until(s.trialEndsAt, 'Free'), detail: 'Set up autopay to keep it online', tone: 'ok' }
  if (s.autopay || s.lineStatus === 'active') return { kind: 'active', label: until(s.paidUntil, 'Paid'), detail: 'Autopay on', tone: 'ok' }
  return { kind: 'unbilled', label: until(s.paidUntil, 'Paid'), detail: null, tone: s.lapsed ? 'warn' : 'ok' }
}
