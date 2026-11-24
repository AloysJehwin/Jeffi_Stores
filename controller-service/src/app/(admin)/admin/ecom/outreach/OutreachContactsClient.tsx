'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api, Badge, btnGhost, inputCls, when } from '@/components/admin/kit/core'
import { CONTACT_STATUSES, type ContactStatus, type OutreachContact } from '@controller/lib/outreach/types'
import { API, BASE, LANGUAGE_LABEL, maskPhone, STATUS_LABEL, STATUS_TONE } from './shared'

type Page = { rows: OutreachContact[]; total: number; page: number; pageSize: number }
const PAGE_SIZE = 50

export const StatusChip = ({ status }: { status: ContactStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? status}</Badge>

export default function OutreachContactsClient() {
  const sp = useSearchParams()
  const initial = (sp?.get('status') || '').split(',').filter((s): s is ContactStatus => (CONTACT_STATUSES as readonly string[]).includes(s))
  const [statuses, setStatuses] = useState<ContactStatus[]>(initial)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let live = true
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (statuses.length) p.set('status', statuses.join(','))
    if (query) p.set('q', query)
    api<Page>(`${API}/contacts?${p}`).then(({ ok, data: d }) => {
      if (!live) return
      if (!ok) return setError(d.error || 'Could not load contacts')
      setError(null)
      setData(d)
    })
    return () => {
      live = false
    }
  }, [statuses, query, page])

  const toggle = (s: ContactStatus) => {
    setStatuses(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]))
    setPage(1)
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {CONTACT_STATUSES.map(s => (
          <button
            key={s}
            type="button"
            aria-pressed={statuses.includes(s)}
            onClick={() => toggle(s)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              statuses.includes(s) ? 'border-accent-500 bg-accent-500/10 text-foreground font-medium' : 'border-border-default text-foreground-muted hover:text-foreground'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        {!!statuses.length && (
          <button type="button" className="px-2 text-xs text-foreground-muted underline" onClick={() => setStatuses([])}>
            Clear
          </button>
        )}
      </div>
      <input aria-label="Search contacts" className={`${inputCls} sm:max-w-sm`} placeholder="Search business, city or phone" value={q} onChange={e => setQ(e.target.value)} />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!data && !error && <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />}
      {data && !data.rows.length && (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-6 text-center text-sm text-foreground-muted">No contacts match.</div>
      )}
      {data && !!data.rows.length && (
        <>
          <div className="md:hidden space-y-2">
            {data.rows.map(c => (
              <Link key={c.id} href={`${BASE}/contacts/${c.id}`} className="block rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground truncate">{c.business_name}</span>
                  <StatusChip status={c.status} />
                </div>
                <div className="text-xs text-foreground-muted truncate">
                  {maskPhone(c.phone)} · {c.city || '-'} · {(c.language && LANGUAGE_LABEL[c.language]) || '-'}
                </div>
                <div className="text-xs text-foreground-muted">
                  {c.attempts} attempts{c.next_attempt_at ? ` · next ${when(c.next_attempt_at)}` : ''}
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border-default bg-surface-elevated">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2">Language</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Attempts</th>
                  <th className="px-3 py-2">Next attempt</th>
                  <th className="px-3 py-2">Site</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(c => (
                  <tr key={c.id} className="border-t border-border-default/60">
                    <td className="px-3 py-2">
                      <Link href={`${BASE}/contacts/${c.id}`} className="font-medium text-foreground hover:underline">
                        {c.business_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{maskPhone(c.phone)}</td>
                    <td className="px-3 py-2">{c.city || '-'}</td>
                    <td className="px-3 py-2">{(c.language && LANGUAGE_LABEL[c.language]) || '-'}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={c.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.attempts}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{when(c.next_attempt_at)}</td>
                    <td className="px-3 py-2">
                      {c.showcase_site_id ? (
                        <Link href={`${BASE}/contacts/${c.id}#site`} className="text-accent-500 hover:underline">
                          Site
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <span>{data.total.toLocaleString('en-IN')} contacts</span>
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
