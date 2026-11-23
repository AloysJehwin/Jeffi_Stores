'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Check, Copy, ExternalLink, Globe, Inbox, Loader2, Pencil } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { ShowcaseConsoleState } from '@controller/lib/showcase/state'
import PageHeader from '../../_components/PageHeader'
import { Card, Row } from '../../_components/Card'
import HostText from '../../_components/HostText'
import { showcaseOfferText, showcasePriceText } from '@/lib/showcase/offer'

type Action = 'publish' | 'pause' | 'resume' | 'renew_on' | 'renew_off' | 'pay'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

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

/** One Showcase site's console page: its address, whether it is online, and its hosting. */
export default function ShowcaseClient({ initial, tenantSlug }: { initial: ShowcaseConsoleState; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState<Action | null>(null)
  const [confirmPay, setConfirmPay] = useState(false)
  const short = s.balanceInr !== null && s.balanceInr < s.priceInr
  const t = `?tenant=${encodeURIComponent(tenantSlug)}`
  const base = `/dashboard/showcase/${s.id}`
  const walletHref = `/dashboard/wallet${t}`
  const analyticsHref = `${base}/analytics${t}`
  // A draft is still in the builder; a published site is edited from the console.
  const editHref = s.status === 'draft' ? `/onboard/showcase?site=${s.id}` : `${base}/edit${t}`

  async function act(action: Action, done?: string) {
    setBusy(action)
    try {
      const res = await fetch(`/api/ecom/showcase/${s.id}/hosting${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Something went wrong. Please try again.', 'error')
        return
      }
      setS(data)
      if (done) showToast(done, 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
      setConfirmPay(false)
    }
  }

  const spin = (a: Action) => (busy === a ? <Loader2 className="h-4 w-4 animate-spin" /> : null)
  const unpaidOffline = s.status === 'paused' && s.pauseReason === 'unpaid'

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
                  {s.lapsed && ` Going live charges ${inr(s.priceInr)} for a month from your wallet.`}
                </p>
                {short && s.lapsed ? (
                  <Link href={walletHref} className={primary}>
                    Top up wallet
                  </Link>
                ) : (
                  <button type="button" onClick={() => act('resume', 'Your site is live again')} disabled={!!busy} className={primary}>
                    {spin('resume')} {s.lapsed ? `Pay ${inr(s.priceInr)} and go live` : 'Go live again'}
                  </button>
                )}
              </div>
            )}
          </div>
        </Card>

        {s.status !== 'draft' && (
          <Card title="Hosting">
            <div className="space-y-2.5">
              <Row
                label={s.free ? 'Free until' : 'Paid until'}
                value={s.paidUntil ? <span className={s.lapsed ? 'text-[#8a2e1f]' : ''}>{fmtDate(s.paidUntil)}</span> : '—'}
              />
              <Row label="Price" value={showcasePriceText(s.priceInr)} />
              {s.balanceInr !== null && <Row label="Wallet balance" value={<span className={short ? 'text-[#8a2e1f]' : ''}>{inr(s.balanceInr)}</span>} />}
            </div>

            {s.pausesOn && (
              <p className="mt-4 rounded-xl org-peach px-4 py-3 text-sm text-foreground">
                Hosting is unpaid{s.lastChargeError ? ` (${s.lastChargeError})` : ''}. We try again every day; the site goes offline on{' '}
                <strong>{fmtDate(s.pausesOn)}</strong> unless it is paid.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-default pt-5">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--org-terracotta-deep)]"
                  checked={s.renew}
                  disabled={!!busy}
                  onChange={e => act(e.target.checked ? 'renew_on' : 'renew_off', e.target.checked ? 'Auto-renew is on' : 'Auto-renew is off')}
                />
                Renew automatically every month
              </label>
              {busy === 'renew_on' || busy === 'renew_off' ? <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" /> : null}
              <span className="w-full text-xs text-foreground-muted">
                {s.renew
                  ? 'We remind you three days before each renewal. A short wallet is retried daily for a week.'
                  : `Auto-renew is off: the site goes offline when ${s.free ? 'the free days end' : 'the paid month ends'}.`}
              </span>
            </div>

            {s.due && !unpaidOffline && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-default pt-5">
                {short ? (
                  <>
                    <span className="text-sm text-foreground">Top up {inr(s.priceInr - (s.balanceInr ?? 0))} or more to pay the next month.</span>
                    <Link href={walletHref} className={primary}>
                      Top up wallet
                    </Link>
                  </>
                ) : confirmPay ? (
                  <>
                    <span className="text-sm text-foreground">Pay {inr(s.priceInr)} from your wallet for the next month?</span>
                    <button type="button" onClick={() => act('pay', 'Paid. Thank you!')} disabled={!!busy} className={primary}>
                      {spin('pay')} Confirm
                    </button>
                    <button type="button" onClick={() => setConfirmPay(false)} disabled={!!busy} className={secondary}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-foreground">{s.lapsed ? 'This month is unpaid.' : 'The next month is due soon.'}</span>
                    <button type="button" onClick={() => setConfirmPay(true)} className={primary}>
                      Pay now · {inr(s.priceInr)}
                    </button>
                  </>
                )}
              </div>
            )}
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
