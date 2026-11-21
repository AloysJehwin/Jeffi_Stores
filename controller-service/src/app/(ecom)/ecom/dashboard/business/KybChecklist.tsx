'use client'

import Link from 'next/link'
import { ChevronRight, Loader2 } from 'lucide-react'
import { ITEM_LABEL, SERVICE_LABEL, type ItemState, type ItemStatus, type KybItem, type KybService } from '@controller/lib/kyb/requirements'
import type { KybView } from '@controller/lib/kyb/view'
import { Badge } from '../../onboard/ui'

// What a service still needs from the owner, shared by the Business verification page and the Services cards.
// Each row links to where it is fixed.

type Tone = 'sage' | 'peach' | 'red' | 'muted'

export type KybGate = Pick<KybView, 'services' | 'items'>

export interface TodoRow {
  item: KybItem
  label: string
  problem?: string
  state?: ItemState
}

export const todoRows = (todo: KybItem[], items: Partial<Record<KybItem, ItemStatus>>): TodoRow[] =>
  todo.map(item => ({ item, label: ITEM_LABEL[item] ?? item, problem: items[item]?.problem, state: items[item]?.state }))

export const ITEM_BADGE: Record<ItemState, { label: string; tone: Tone } | null> = {
  missing: { label: 'To do', tone: 'peach' },
  invalid: { label: 'Needs a fix', tone: 'red' },
  checking: { label: 'Checking…', tone: 'muted' },
  review: { label: 'With a reviewer', tone: 'peach' },
  complete: { label: 'Done', tone: 'sage' },
  approved: { label: 'Verified', tone: 'sage' },
  rejected: { label: 'Not accepted', tone: 'red' },
  not_needed: null,
}

const ANCHOR: Partial<Record<KybItem, string>> = { registration: 'gst', messaging_use: 'messaging' }

/** The payout account and licences have pages of their own; the rest are sections of the Business verification page. */
export function itemHref(item: KybItem, service?: string | null, local = false) {
  if (item === 'bank') return '/dashboard/payouts'
  if (item === 'licences') return '/dashboard/licences'
  const hash = `#kyb-${ANCHOR[item] ?? item}`
  return local ? hash : `/dashboard/business${service ? `?for=${service}` : ''}${hash}`
}

export function TodoList({ rows, service, local = false, className = '' }: { rows: TodoRow[]; service?: string | null; local?: boolean; className?: string }) {
  const cls = 'group -mx-2 flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ecom-hover ecom-focus'
  return (
    <ul className={`space-y-0.5 ${className}`}>
      {rows.map(r => {
        const href = itemHref(r.item, service, local)
        const checking = r.state === 'checking'
        const body = (
          <>
            {checking ? (
              <Loader2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-foreground-muted" />
            ) : (
              <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--org-terracotta)]" />
            )}
            <span className="min-w-0 flex-1 break-words">
              <span className="font-semibold text-foreground">{r.label}</span>
              <span className="text-foreground-secondary">{checking ? ': checking your document…' : r.problem ? `: ${r.problem}` : ''}</span>
            </span>
            <ChevronRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted group-hover:text-foreground" />
          </>
        )
        return (
          <li key={r.item}>
            {href.startsWith('#') ? (
              <a href={href} className={cls}>
                {body}
              </a>
            ) : (
              <Link href={href} className={cls}>
                {body}
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type Phase = 'off' | 'pending' | 'rejected' | 'live'

const APPROVAL: Record<Phase, { label: string; tone: Tone }> = {
  off: { label: 'Not requested', tone: 'muted' },
  pending: { label: 'Awaiting approval', tone: 'peach' },
  rejected: { label: 'Not approved', tone: 'red' },
  live: { label: 'Live', tone: 'sage' },
}

function StandingRow({ service, kyb }: { service: KybService; kyb: KybGate }) {
  const st = kyb.services[service]
  const api = service === 'messaging' || service === 'documents'
  const phase: Phase = !api ? 'live' : !st.active ? 'off' : st.approval === 'pending' ? 'pending' : st.approval === 'rejected' ? 'rejected' : 'live'
  const canRequest = api && (phase === 'off' || phase === 'rejected')
  const rows = todoRows(st.todo, kyb.items)
  const owed = rows.filter(r => r.state !== 'checking').length
  const badge: { label: string; tone: Tone } = st.verified
    ? { label: 'Verified', tone: 'sage' }
    : st.ready
      ? { label: 'With a reviewer', tone: 'peach' }
      : owed
        ? { label: `${owed} to do`, tone: 'red' }
        : { label: 'Checking…', tone: 'muted' }
  const said = !st.ready
    ? !owed
      ? 'We’re checking your documents.'
      : phase === 'pending'
        ? 'Jeffi can approve it once these are done.'
        : canRequest
          ? 'Complete these, then request it on Services.'
          : service === 'store'
            ? 'Your store still needs these.'
            : 'It is on, but your business isn’t fully verified yet.'
    : st.verified
      ? phase === 'pending'
        ? 'Verified. Jeffi switches it on once approved.'
        : canRequest
          ? 'Verified. You can request it now.'
          : 'Verified.'
      : phase === 'pending'
        ? 'Everything is in. Jeffi reviews it and switches it on.'
        : canRequest
          ? 'Everything is in. You can request it now.'
          : 'Everything is in. A reviewer is checking your documents.'
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{SERVICE_LABEL[service]}</h3>
          <p className="mt-0.5 text-sm text-foreground-secondary">{said}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {api && <Badge tone={APPROVAL[phase].tone}>{APPROVAL[phase].label}</Badge>}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </div>
      {!st.ready && rows.length > 0 && <TodoList rows={rows} local className="mt-2" />}
      {st.ready && canRequest && (
        <Link href="/dashboard/services" className="mt-2 inline-flex text-sm font-semibold ecom-accent-text hover:underline">
          Request it on Services
        </Link>
      )}
    </li>
  )
}

/** Where each service stands: its approval, and what its verification still needs. */
export function ServiceStanding({ kyb, services }: { kyb: KybGate; services: KybService[] }) {
  return (
    <section aria-labelledby="kyb-standing-title" className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 id="kyb-standing-title" className="mb-4 text-xs font-semibold uppercase tracking-widest text-foreground-muted">
        Where your services stand
      </h2>
      <ul className="divide-y divide-border-default/60">
        {services.map(s => (
          <StandingRow key={s} service={s} kyb={kyb} />
        ))}
      </ul>
    </section>
  )
}
