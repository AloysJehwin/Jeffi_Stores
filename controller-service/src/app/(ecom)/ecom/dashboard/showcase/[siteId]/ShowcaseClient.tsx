'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Check, Copy, ExternalLink, Globe, Inbox, Loader2, Pencil } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import type { ShowcaseConsoleState, StorePlanOffer } from '@controller/lib/showcase/state'
import { fmtDay as fmtDate, hostingView, needsKeepOnline } from '@controller/lib/showcase/hosting'
import KeepOnline from '@controller/components/ecom/KeepOnline'
import PageHeader from '../../_components/PageHeader'
import { Card, Row } from '../../_components/Card'
import HostText from '../../_components/HostText'
import { showcaseMonthly, showcaseOfferText, showcasePriceText } from '@/lib/showcase/offer'

type Action = 'publish' | 'pause' | 'resume' | 'autopay' | 'renew_off'

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const primary = `${btn} ecom-accent-bg text-white`
const secondary = `${btn} border border-border-default text-foreground hover:bg-surface-secondary`

function StatusPill({ s }: { s: ShowcaseConsoleState }) {
  const [label, cls] =
    s.status === 'live'
      ? ['Live', 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]']
      : s.status === 'paused'
        ? [s.pauseReason === 'unpaid' ? 'Offline · unpaid' : 'Paused', 'org-peach text-foreground']
        : ['Draft', 'org-sand text-foreground-secondary']
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={secondary}
      aria-label="Copy the site address"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

const sep = 'mt-5 flex flex-wrap items-center gap-3 border-t border-border-default pt-5'

/** What the owner can do about hosting now: set up, approve, stop or restart autopay. KeepOnline covers lapsed and halted. */
function HostingAction({
  s,
  kind,
  busy,
  spin,
  t,
  onAutopay,
  onAutopayOff,
}: {
  s: ShowcaseConsoleState
  kind: ReturnType<typeof hostingView>['kind']
  busy: Action | null
  spin: (a: Action) => ReactNode
  t: string
  onAutopay: () => void
  onAutopayOff: () => void
}) {
  const text = 'min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary'
  const price = showcaseMonthly(s.priceInr)
  if (kind === 'trial')
    return (
      <div className={sep}>
        <p className={text}>
          Set up autopay to keep it online: nothing is charged until {s.trialEndsAt ? fmtDate(s.trialEndsAt) : 'the free days end'}, then {price}. Without it, the site goes offline when the free days end.
        </p>
        <button type="button" onClick={onAutopay} disabled={!!busy} className={primary}>
          {spin('autopay')} Set up autopay
        </button>
      </div>
    )
  if (kind === 'approve')
    return (
      <div className={sep}>
        <p className={text}>You started autopay but haven&apos;t approved it yet. Approve it on Razorpay to keep the site online.</p>
        <a href={s.checkoutUrl!} className={primary}>
          Approve autopay
        </a>
      </div>
    )
  if (kind === 'trial_autopay' || kind === 'active')
    return (
      <div className={sep}>
        <p className={text}>
          {kind === 'trial_autopay' && s.trialEndsAt ? `Autopay is set: the first ${price} is charged on ${fmtDate(s.trialEndsAt)}.` : `${price} is charged on your subscription each month.`}
        </p>
        <button type="button" onClick={onAutopayOff} disabled={!!busy} className={secondary}>
          {spin('renew_off')} Turn off autopay
        </button>
      </div>
    )
  if (kind === 'ending')
    return (
      <div className={sep}>
        <p className={text}>Autopay is off: the site goes offline{s.endsAt ? ` on ${fmtDate(s.endsAt)}` : ' when the paid month ends'}.</p>
        <button type="button" onClick={onAutopay} disabled={!!busy} className={primary}>
          {spin('autopay')} Turn autopay back on
        </button>
      </div>
    )
  if (kind === 'legacy')
    return (
      <div className={sep}>
        <p className={text}>
          Hosting is still paid from your wallet. Move it to your subscription{s.graceUntil ? ` by ${fmtDate(s.graceUntil)}` : ''} to keep it online.
        </p>
        <Link href={`/dashboard/billing/subscribe${t}`} className={primary}>
          Move to subscription
        </Link>
      </div>
    )
  return null
}

/** One Showcase site's console page: its address, whether it is online, and its hosting. */
export default function ShowcaseClient({ initial, tenantSlug, plans }: { initial: ShowcaseConsoleState; tenantSlug: string; plans: StorePlanOffer[] | null }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState<Action | null>(null)
  const t = `?tenant=${encodeURIComponent(tenantSlug)}`
  const base = `/dashboard/showcase/${s.id}`
  const analyticsHref = `${base}/analytics${t}`
  // A draft is still in the builder; a published site is edited from the console.
  const editHref = s.status === 'draft' ? `/onboard/showcase?site=${s.id}` : `${base}/edit${t}`

  async function act(action: Action, done?: string) {
    setBusy(action)
    let leaving = false
    try {
      const res = await fetch(`/api/ecom/showcase/${s.id}/hosting${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      // 402 with a checkoutUrl: the owner approves autopay on Razorpay.
      if (!res.ok && data.checkoutUrl) {
        leaving = true
        showToast('Opening Razorpay to approve autopay…', 'info')
        window.location.href = data.checkoutUrl
        return
      }
      if (!res.ok) {
        showToast(data.error || 'Something went wrong. Please try again.', 'error')
        return
      }
      setS(data)
      if (done) showToast(done, 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      if (!leaving) setBusy(null)
    }
  }

  async function autopayOff() {
    const last = s.free ? s.trialEndsAt : s.paidUntil
    const ok = await confirm({
      title: 'Turn off autopay?',
      message: `${s.host} stays online${last ? ` until ${fmtDate(last)}` : ''}, then goes offline. Your page and enquiries are kept.`,
      confirmLabel: 'Turn off autopay',
      variant: 'danger',
    })
    if (ok) act('renew_off', 'Autopay is off')
  }

  const spin = (a: Action) => (busy === a ? <Loader2 className="h-4 w-4 animate-spin" /> : null)
  const unpaidOffline = s.status === 'paused' && s.pauseReason === 'unpaid'
  const hosting = hostingView(s)
  const keep = needsKeepOnline(s)
  const autopayLabel = s.autopay ? 'On' : s.checkoutUrl ? 'Waiting for your approval' : s.lineStatus === 'ending' ? 'Off' : 'Not set up'

  return (
    <>
      <PageHeader
        eyebrow="Showcase"
        title={s.name}
        actions={
          <>
            <Link href={`/dashboard/showcase${t}`} className={secondary}>
              <ArrowLeft className="h-4 w-4" /> All sites
            </Link>
            <StatusPill s={s} />
            <Link href={editHref} className={secondary}>
              <Pencil className="h-4 w-4" /> {s.status === 'draft' ? 'Continue setting up' : 'Edit site'}
            </Link>
            {s.status !== 'draft' && (
              <Link href={analyticsHref} className={secondary}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </Link>
            )}
            {s.status === 'live' && (
              <a href={s.previewUrl} target="_blank" rel="noopener noreferrer" className={primary}>
                Open site <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {keep && <KeepOnline site={s} plans={plans} tenantSlug={tenantSlug} busy={busy === 'resume' || busy === 'autopay'} onKeep={() => act(s.status === 'paused' ? 'resume' : 'autopay', 'Your site is on your subscription')} />}

        <Card title="Your site">
          <div className="flex flex-wrap items-center gap-3">
            <HostText host={s.host} className="min-w-0 font-mono text-sm text-foreground" />
            <div className="ml-auto flex flex-wrap gap-2">
              <CopyButton text={`https://${s.host}`} />
              <a href={s.previewUrl} target="_blank" rel="noopener noreferrer" className={secondary}>
                Open <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Link href={`${base}/domain${t}`} className={secondary}>
                <Globe className="h-4 w-4" /> Domain
              </Link>
            </div>
          </div>

          <div className="mt-5 border-t border-border-default pt-5">
            {s.status === 'draft' && !s.hasPage && (
              <div className="flex flex-wrap items-center gap-4">
                <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">Your page isn&apos;t made yet. Finish it in the editor, then publish it here or there.</p>
                <Link href={editHref} className={primary}>
                  Finish your page
                </Link>
              </div>
            )}
            {s.status === 'draft' && s.hasPage && (
              <div className="flex flex-wrap items-center gap-4">
                <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">
                  Not published yet. Publishing puts it online: {showcaseOfferText()}.
                </p>
                <button type="button" onClick={() => act('publish', 'Your site is live')} disabled={!!busy} className={primary}>
                  {spin('publish')} Publish
                </button>
              </div>
            )}
            {s.status === 'live' && (
              <div className="flex flex-wrap items-center gap-4">
                <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">
                  Online{s.publishedAt ? ` since ${fmtDate(s.publishedAt)}` : ''}. Changes you publish from the editor show here within a minute.
                </p>
                <button type="button" onClick={() => act('pause', 'Your site is paused')} disabled={!!busy} className={secondary}>
                  {spin('pause')} Pause site
                </button>
              </div>
            )}
            {s.status === 'paused' && (
              <div className="flex flex-wrap items-center gap-4">
                <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">
                  {unpaidOffline
                    ? 'Offline because its hosting is unpaid. Visitors see a short note instead of your page. Your page and enquiries are kept.'
                    : 'Paused: visitors see a short note instead of your page. Your page and enquiries are kept.'}
                </p>
                {!keep && (
                  <button type="button" onClick={() => act('resume', 'Your site is live again')} disabled={!!busy} className={primary}>
                    {spin('resume')} Go live again
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>

        {s.status !== 'draft' && (
          <Card title="Hosting">
            <div className="space-y-2.5">
              <Row label="Status" value={<span className={hosting.tone === 'warn' ? 'text-[#8a2e1f]' : ''}>{hosting.label}</span>} />
              <Row label="Price" value={showcasePriceText(s.priceInr)} />
              {hosting.kind !== 'unbilled' && <Row label="Autopay" value={autopayLabel} />}
            </div>
            <HostingAction s={s} kind={hosting.kind} busy={busy} spin={spin} t={t} onAutopay={() => act('autopay', 'Autopay is set')} onAutopayOff={autopayOff} />
          </Card>
        )}

        <Card title="Enquiries">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full org-sand">
              <Inbox className="h-5 w-5 text-foreground" />
            </span>
            <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">
              {s.unreadLeads > 0
                ? `${s.unreadLeads} new ${s.unreadLeads === 1 ? 'enquiry' : 'enquiries'} from your site's contact form.`
                : "Messages from your site's contact form arrive here and in your email."}
            </p>
            <Link href={`${base}/leads${t}`} className={secondary}>
              Open enquiries
            </Link>
          </div>
        </Card>

        {s.status !== 'draft' && (
          <Card title="Visitors">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full org-sand">
                <BarChart3 className="h-5 w-5 text-foreground" />
              </span>
              <p className="min-w-[min(100%,16rem)] flex-1 text-sm text-foreground-secondary">
                Who visits your site, where they come from, what they tap and which visits bring enquiries.
              </p>
              <Link href={analyticsHref} className={secondary}>
                Open analytics
              </Link>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
