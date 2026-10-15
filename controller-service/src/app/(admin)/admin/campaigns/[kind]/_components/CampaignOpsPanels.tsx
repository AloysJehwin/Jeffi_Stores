'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, ChevronDown } from 'lucide-react'
import { campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'

export interface EligibleRecipient {
  reference_id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  marketing_opt_out: boolean
  raw: Record<string, any>
}

export interface SuppressedRecipient {
  reference_id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  reason: string
  reason_detail: string | null
  blocked_until: string | null
  raw: Record<string, any>
}

export interface RecentSend {
  id: string
  user_id: string
  reference_id: string | null
  sent_at: string
  opened_at: string | null
  clicked_at: string | null
  converted_at: string | null
  unsubscribed_at: string | null
  bounced_at: string | null
  user_email: string | null
  user_name: string | null
  send_count: number
}

export interface WhatsAppLog {
  to_number: string
  body: string
  status: string
  error: string | null
  sent_at: string
}

const SENDS_LIMIT = 20
const WA_LIMIT = 10

// Collapsible card — collapsed by default so a long list isn't a wall of rows; the admin expands the one they need.
export function CollapsibleCard({
  title,
  subtitle,
  count,
  defaultOpen = false,
  icon,
  children,
}: {
  title: string
  subtitle?: string
  count?: number
  defaultOpen?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 border-b border-border-default flex items-center justify-between gap-2 text-left hover:bg-surface-secondary/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="min-w-0">
            <span className="text-sm font-semibold text-foreground">
              {title}
              {typeof count === 'number' ? ` (${count})` : ''}
            </span>
            {subtitle ? <span className="block text-[11px] text-foreground-muted mt-0.5">{subtitle}</span> : null}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-foreground-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? children : null}
    </div>
  )
}

function maskNumber(num: string): string {
  const digits = (num || '').replace(/[^\d]/g, '')
  if (digits.length < 6) return num || '—'
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : ''
  const last4 = digits.slice(-4)
  return `${cc ? `+${cc} ` : ''}••••• ${last4}`
}

function sendStatus(s: RecentSend): { label: string; color: string } {
  if (s.bounced_at) return { label: 'Bounced', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (s.unsubscribed_at)
    return { label: 'Unsub', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' }
  if (s.converted_at)
    return { label: 'Converted', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' }
  if (s.clicked_at)
    return { label: 'Clicked', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
  if (s.opened_at) return { label: 'Opened', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' }
  return { label: 'Sent', color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' }
}

/**
 * Eligible recipients (+ Suppressed) — owns its own fetch to the eligible route (mailer:read).
 * Rendered on the read-only campaign view page so admins can see who the next sweep will reach.
 */
export function EligibleRecipientsPanel({ kind }: { kind: string }) {
  const [eligible, setEligible] = useState<EligibleRecipient[] | null>(null)
  const [eligibleTotal, setEligibleTotal] = useState(0)
  const [suppressed, setSuppressed] = useState<SuppressedRecipient[] | null>(null)
  const [suppressedTotal, setSuppressedTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<string | null>(null)

  async function loadEligible() {
    setLoading(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/admin/campaigns/${kind}/eligible`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setEligible([])
        setEligibleTotal(0)
        return
      }
      setEligible(data.eligible || [])
      setEligibleTotal(data.total || 0)
      setSuppressed(data.suppressed || [])
      setSuppressedTotal(data.suppressedTotal || 0)
      setTrigger(data.trigger || null)
      if (data.note) setNote(data.note)
    } catch (err: any) {
      setError(err?.message || 'Network error')
      setEligible([])
      setEligibleTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEligible()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  return (
    <div className="space-y-5">
      <CollapsibleCard
        title="Eligible recipients"
        count={eligible !== null ? eligibleTotal : undefined}
        subtitle={trigger ?? undefined}
      >
        <div className="px-5 py-2.5 border-b border-border-default flex items-center justify-end">
          <button
            type="button"
            onClick={loadEligible}
            disabled={loading}
            className="px-3 h-control-sm text-xs font-semibold rounded-lg border border-border-default text-foreground hover:bg-surface-secondary disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {error ? (
          <p className="p-8 text-sm text-red-500 text-center">{error}</p>
        ) : note ? (
          <p className="p-8 text-sm text-foreground-muted text-center italic">{note}</p>
        ) : loading && !eligible ? (
          <div className="p-4 space-y-2 animate-pulse" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 rounded bg-surface-secondary" />
            ))}
          </div>
        ) : eligible && eligible.length === 0 ? (
          <p className="p-8 text-sm text-foreground-muted text-center">
            No customers currently match this campaign&apos;s trigger.
            <br />
            <span className="text-[11px]">
              When a customer crosses the threshold, they will appear here and the next sweep will email them.
            </span>
          </p>
        ) : eligible && eligible.length > 0 ? (
          <div className="divide-y divide-border-default max-h-96 overflow-y-auto">
            {eligible.map((r, i) => (
              <div
                key={r.reference_id || `row-${i}`}
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-secondary/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {r.user_name || r.user_email || <span className="text-foreground-muted italic">No user</span>}
                    {r.marketing_opt_out && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        opted out
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-foreground-muted truncate">
                    {r.user_email || ''}
                    {r.raw?.order_number ? ` · #${r.raw.order_number}` : ''}
                    {r.raw?.total_amount ? ` · ₹${Number(r.raw.total_amount).toLocaleString('en-IN')}` : ''}
                    {r.raw?.product_name ? ` · ${r.raw.product_name}` : ''}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-foreground-muted">
                  {(r.reference_id || '').slice(0, 8) || '—'}…
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CollapsibleCard>

      {suppressed && suppressed.length > 0 && (
        <CollapsibleCard
          title="Suppressed"
          count={suppressedTotal}
          subtitle="Customers who would otherwise qualify but are blocked from receiving this campaign right now."
        >
          <div className="divide-y divide-border-default max-h-96 overflow-y-auto">
            {suppressed.map((r, i) => {
              const reasonColor =
                r.reason === 'cooldown' || r.reason === 'recent_send'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : r.reason === 'opted_out'
                    ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              const reasonLabel =
                r.reason === 'cooldown'
                  ? 'Cooldown'
                  : r.reason === 'recent_send'
                    ? 'Already sent'
                    : r.reason === 'opted_out'
                      ? 'Opted out'
                      : r.reason === 'inactive'
                        ? 'Inactive'
                        : r.reason
              return (
                <div
                  key={r.reference_id || `sup-${i}`}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-surface-secondary/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">
                      {r.user_name || r.user_email || <span className="text-foreground-muted italic">No user</span>}
                    </p>
                    <p className="text-[11px] text-foreground-muted truncate">
                      {r.user_email || ''}
                      {r.reason_detail ? ` · ${r.reason_detail}` : ''}
                      {r.blocked_until
                        ? ` · unblocks ${new Date(r.blocked_until).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
                        : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${reasonColor}`}>
                    {reasonLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </CollapsibleCard>
      )}
    </div>
  )
}

/**
 * Recent sends — initial batch comes in as props (from the campaign GET the view already made);
 * pagination refetches only the sends slice via `?offset=`.
 */
export function RecentSendsPanel({
  kind,
  initialSends,
  initialTotal,
}: {
  kind: string
  initialSends: RecentSend[]
  initialTotal: number
}) {
  const [recentSends, setRecentSends] = useState<RecentSend[]>(initialSends)
  const [sendsTotal, setSendsTotal] = useState(initialTotal)
  const [sendsOffset, setSendsOffset] = useState(0)
  const [sendsLoading, setSendsLoading] = useState(false)

  async function loadSendsPage(o: number) {
    setSendsOffset(o)
    setSendsLoading(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${kind}?offset=${o}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setRecentSends(data.recentSends || [])
        setSendsTotal(data.total || 0)
      }
    } finally {
      setSendsLoading(false)
    }
  }

  return (
    <CollapsibleCard title="Recent sends" count={sendsTotal}>
      {recentSends.length === 0 ? (
        <p className="p-8 text-sm text-foreground-muted text-center">No sends yet</p>
      ) : (
        <div className={sendsLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-5 py-2 border-b border-border-default bg-surface-secondary/40">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Customer</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted text-center">
              Sends
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted text-right">
              Status
            </span>
          </div>
          <div className="divide-y divide-border-default">
            {recentSends.map(s => {
              const st = sendStatus(s)
              return (
                <div
                  key={s.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-5 py-3 hover:bg-surface-secondary/50"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{s.user_name || s.user_email}</p>
                    <p className="text-[10px] text-foreground-muted truncate">
                      {s.user_email}
                      {' · '}
                      {new Date(s.sent_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-foreground text-center">{Number(s.send_count)}</p>
                  <div className="flex justify-end">
                    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${st.color}`}>{st.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {sendsTotal > SENDS_LIMIT && (
            <div className="px-5 py-3 border-t border-border-default flex items-center justify-between text-xs text-foreground-muted">
              <span>
                {sendsOffset + 1}–{Math.min(sendsOffset + SENDS_LIMIT, sendsTotal)} of {sendsTotal}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={sendsOffset === 0 || sendsLoading}
                  onClick={() => loadSendsPage(Math.max(0, sendsOffset - SENDS_LIMIT))}
                  className="px-3 h-control-sm rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={sendsOffset + SENDS_LIMIT >= sendsTotal || sendsLoading}
                  onClick={() => loadSendsPage(sendsOffset + SENDS_LIMIT)}
                  className="px-3 h-control-sm rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  )
}

/**
 * WhatsApp Log — the API returns the recent batch; pagination is pure client-side slicing.
 * Gated to kinds that support WhatsApp (returns null otherwise so callers can render it unconditionally).
 */
export function WhatsAppLogPanel({ kind, logs }: { kind: string; logs: WhatsAppLog[] }) {
  const [waPage, setWaPage] = useState(0)
  if (!campaignSupportsWhatsApp(kind)) return null
  return (
    <CollapsibleCard
      title="WhatsApp Log"
      count={logs.length}
      icon={<MessageCircle className="w-4 h-4 text-foreground-muted" />}
    >
      {logs.length === 0 ? (
        <p className="p-8 text-sm text-foreground-muted text-center">No WhatsApp messages sent yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[120px_1fr_auto] gap-3 px-5 py-2 border-b border-border-default bg-surface-secondary/40">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Recipient</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Message</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted text-right">
              Status
            </span>
          </div>
          <div className="divide-y divide-border-default">
            {logs.slice(waPage * WA_LIMIT, waPage * WA_LIMIT + WA_LIMIT).map((w, i) => {
              const sent = w.status === 'sent'
              return (
                <div
                  key={`${w.to_number}-${w.sent_at}-${i}`}
                  className="grid grid-cols-[120px_1fr_auto] gap-3 items-center px-5 py-3 hover:bg-surface-secondary/50"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-foreground truncate">{maskNumber(w.to_number)}</p>
                    <p className="text-[10px] text-foreground-muted">
                      {new Date(w.sent_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                    </p>
                  </div>
                  <p className="text-xs text-foreground-muted truncate" title={w.body}>
                    {w.body}
                  </p>
                  <div className="flex justify-end">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        sent
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      }`}
                      title={!sent && w.error ? w.error : undefined}
                    >
                      {sent ? 'Sent' : 'Failed'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {logs.length > WA_LIMIT && (
            <div className="px-5 py-3 border-t border-border-default flex items-center justify-between text-xs text-foreground-muted">
              <span>
                {waPage * WA_LIMIT + 1}–{Math.min(waPage * WA_LIMIT + WA_LIMIT, logs.length)} of {logs.length}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={waPage === 0}
                  onClick={() => setWaPage(p => Math.max(0, p - 1))}
                  className="px-3 h-control-sm rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={(waPage + 1) * WA_LIMIT >= logs.length}
                  onClick={() => setWaPage(p => p + 1)}
                  className="px-3 h-control-sm rounded-lg bg-surface-secondary hover:bg-border-default text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </CollapsibleCard>
  )
}
