'use client'

import { useState } from 'react'
import { Inbox, Loader2, Mail, MessageCircle, Phone } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { ShowcaseLead } from '@/lib/showcase/store'
import { phoneLinks } from '@/lib/showcase/phone'

interface Page {
  leads: ShowcaseLead[]
  total: number
  unread: number
}

// IST on the server render and in the browser alike (a server in UTC would otherwise disagree with the page).
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

const chip = 'inline-flex items-center gap-1.5 rounded-full border border-border-default px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-secondary'

/** The Showcase's enquiries: newest first, open ones marked. Handled (read_at) is the owner's own bookkeeping. */
export default function LeadsClient({ initial, pageSize, siteId, tenantSlug }: { initial: Page; pageSize: number; siteId: string; tenantSlug: string }) {
  const { showToast } = useToast()
  const [page, setPage] = useState(initial)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const api = `/api/ecom/showcase/${siteId}/leads?tenant=${encodeURIComponent(tenantSlug)}`

  async function load(opts: { unread: boolean; offset: number }) {
    setBusy('load')
    try {
      const res = await fetch(`${api}&offset=${opts.offset}${opts.unread ? '&unread=1' : ''}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return showToast(data.error || 'Could not load enquiries', 'error')
      setPage(p => ({ ...data, leads: opts.offset ? [...p.leads, ...data.leads] : data.leads }))
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function mark(ids: string[] | 'all', read: boolean) {
    setBusy(ids === 'all' ? 'all' : ids[0])
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: read ? 'read' : 'unread', ids }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return showToast(data.error || 'Could not update', 'error')
      const now = new Date().toISOString()
      setPage(p => {
        const leads = p.leads
          .map(l => (ids === 'all' || ids.includes(l.id) ? { ...l, readAt: read ? (l.readAt ?? now) : null } : l))
          .filter(l => !(unreadOnly && read && l.readAt))
        return { ...p, leads, unread: Math.max(0, p.unread + (read ? -data.changed : data.changed)) }
      })
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  function filter(unread: boolean) {
    setUnreadOnly(unread)
    load({ unread, offset: 0 })
  }

  const shown = page.leads.length
  const more = shown < (unreadOnly ? page.unread : page.total)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([false, true] as const).map(u => (
          <button
            key={String(u)}
            type="button"
            onClick={() => filter(u)}
            disabled={busy === 'load'}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${unreadOnly === u ? 'ecom-current font-semibold' : 'text-foreground-secondary ecom-hover hover:text-foreground'}`}
          >
            {u ? `Open (${page.unread})` : `All (${page.total})`}
          </button>
        ))}
        {page.unread > 0 && (
          <button type="button" onClick={() => mark('all', true)} disabled={!!busy} className="ml-auto text-sm font-semibold ecom-accent-text hover:underline disabled:opacity-50">
            {busy === 'all' ? 'Marking…' : 'Mark all handled'}
          </button>
        )}
      </div>

      {shown === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-border-default bg-surface-elevated px-6 py-14 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full org-sand">
            <Inbox className="h-6 w-6 text-foreground" />
          </span>
          <p className="text-sm text-foreground-secondary">{unreadOnly ? 'No open enquiries. Everything is handled.' : 'No enquiries yet. They appear here when visitors use the contact form on your site.'}</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {page.leads.map(l => {
            const { tel, whatsapp: wa } = l.phone ? phoneLinks(l.phone) : { tel: '', whatsapp: '' }
            return (
              <li key={l.id} className={`rounded-2xl border bg-surface-elevated p-5 ${l.readAt ? 'border-border-default' : 'border-[var(--org-terracotta-deep)]/40'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {!l.readAt && <span role="img" aria-label="Open" className="h-2 w-2 shrink-0 rounded-full ecom-accent-bg" />}
                      <h2 className={`break-words text-base text-foreground ${l.readAt ? 'font-semibold' : 'font-black'}`}>{l.name}</h2>
                    </div>
                    <p className="mt-0.5 text-xs text-foreground-muted">
                      {when(l.createdAt)}
                      {l.readAt && ` · Handled ${when(l.readAt)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => mark([l.id], !l.readAt)}
                    disabled={!!busy}
                    className="text-xs font-semibold text-foreground-secondary hover:text-foreground disabled:opacity-50"
                  >
                    {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : l.readAt ? 'Reopen' : 'Mark handled'}
                  </button>
                </div>
                {l.message && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground">{l.message}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {tel && (
                    <a href={tel} className={chip}>
                      <Phone className="h-3.5 w-3.5" /> {l.phone}
                    </a>
                  )}
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className={chip}>
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  )}
                  {l.email && (
                    <a href={`mailto:${l.email}`} className={chip}>
                      <Mail className="h-3.5 w-3.5" /> {l.email}
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {more && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load({ unread: unreadOnly, offset: shown })}
            disabled={busy === 'load'}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-default px-5 py-2 text-sm font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50"
          >
            {busy === 'load' && <Loader2 className="h-4 w-4 animate-spin" />} Show {Math.min(pageSize, (unreadOnly ? page.unread : page.total) - shown)} more
          </button>
        </div>
      )}
    </div>
  )
}
