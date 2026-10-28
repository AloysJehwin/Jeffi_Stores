'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRight, Ban, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import AdminAgentBlocks, { type UiBlock } from '../AdminAgentBlocks'
import type { ActionStatus, ProposedAction } from '@/hooks/useAdminAgentChat'
import { badgeCls, type Tone } from '../kit/tones'
import { adminHref, fmtINR, humanizeKind, parseNumber } from './format'

// One card per proposed action, whatever its kind: preview blocks, the confirmation
// sentence, Approve / Reject, then the outcome.

const PREVIEW_TYPES = new Set(['document', 'change_summary'])

/**
 * Moves proposal previews into their action's card: an action's own blocks, else the turn's
 * document / change_summary blocks (all of them for a single action, by order when the counts match).
 */
export function splitProposalBlocks(blocks: UiBlock[] | undefined, actions: ProposedAction[] | undefined) {
  const all = blocks || []
  const byAction: Record<string, UiBlock[]> = {}
  for (const a of actions || []) if (a.blocks?.length) byAction[a.id] = a.blocks
  const open = (actions || []).filter(a => !a.blocks?.length)
  const idx = all.map((b, i) => (PREVIEW_TYPES.has(b.type) ? i : -1)).filter(i => i >= 0)
  if (!open.length || !idx.length || (open.length > 1 && open.length !== idx.length)) return { rest: all, byAction }
  idx.forEach((bi, k) => {
    const id = (open.length === 1 ? open[0] : open[k]).id
    ;(byAction[id] ||= []).push(all[bi])
  })
  const taken = new Set(idx)
  return { rest: all.filter((_, i) => !taken.has(i)), byAction }
}

interface Outcome {
  text?: string
  href?: string
  linkLabel?: string
}

/** A one-line summary and a link from an executed action's result, when it carries one. */
export function describeResult(kind: string, result: unknown): Outcome | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' && r[k] ? (r[k] as string) : null)
  const total = parseNumber(r.total ?? r.totalAmount ?? r.total_amount)
  const money = total != null ? fmtINR(total) : null
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined

  if (str('quotationId'))
    return {
      text: join(`Quotation ${str('quoteNumber') ?? ''} created`.replace(/\s+/g, ' '), money),
      href: `/admin/quotations/${str('quotationId')}`,
      linkLabel: 'Open quotation',
    }
  if (str('invoiceId'))
    return { text: join(str('invoiceNumber') && `Invoice ${str('invoiceNumber')}`, money), href: `/admin/invoices/${str('invoiceId')}/view`, linkLabel: 'Open invoice' }
  if (str('orderId'))
    return { text: join(str('orderNumber') && `Order ${str('orderNumber')}`, money), href: `/admin/orders/${str('orderId')}/view`, linkLabel: 'Open order' }
  const productId = str('productId') ?? (/product/.test(kind) ? str('id') : null)
  if (productId) return { text: join(str('summary'), str('name')), href: `/admin/products/${productId}`, linkLabel: 'Open product' }
  if (str('customerId')) return { text: join(str('summary'), str('title')), href: `/admin/customers/${str('customerId')}/view`, linkLabel: 'Open customer' }
  const href = str('href')
  return {
    text: join(str('summary'), str('sentTo') && `Sent to ${str('sentTo')}`, str('code') && `Code ${str('code')}`, money),
    href: href && href.startsWith('/admin') ? href : undefined,
  }
}

const STATE: Record<ActionStatus, { label: string; tone: Tone; frame: string }> = {
  proposed: { label: 'Needs approval', tone: 'amber', frame: 'border-amber-500/40 bg-amber-500/[0.04]' },
  approving: { label: 'Working', tone: 'blue', frame: 'border-accent-500/40 bg-accent-500/[0.04]' },
  approved: { label: 'Done', tone: 'green', frame: 'border-green-500/40 bg-green-500/[0.04]' },
  failed: { label: 'Failed', tone: 'red', frame: 'border-red-500/40 bg-red-500/[0.04]' },
  rejected: { label: 'Rejected', tone: 'muted', frame: 'border-border-default' },
}

interface Props {
  action: ProposedAction
  /** Preview blocks for this action (see splitProposalBlocks). */
  blocks?: UiBlock[]
  onDecide: (decision: 'approve' | 'reject') => void
  /** Wraps the Approve/Reject buttons (the page gates them on agent:write). */
  approveWrapper?: (node: ReactNode) => ReactNode
}

export default function ProposedActionCard({ action, blocks, onDecide, approveWrapper }: Props) {
  const wrap = approveWrapper ?? ((n: ReactNode) => n)
  const state = STATE[action.status] ?? STATE.proposed
  const outcome = action.status === 'approved' ? describeResult(action.kind, action.result) : null

  return (
    <div className={`max-w-2xl overflow-hidden rounded-xl border ${state.frame}`}>
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-2">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {humanizeKind(action.kind) || 'Proposed action'}
        </p>
        <span className={`${badgeCls(state.tone)} shrink-0`}>{state.label}</span>
      </div>

      <div className="space-y-3 p-3">
        {blocks && blocks.length > 0 && (
          <div className={action.status === 'rejected' ? 'opacity-60' : ''}>
            <AdminAgentBlocks blocks={blocks} />
          </div>
        )}
        {action.confirmation && <p className="text-xs font-medium text-foreground [overflow-wrap:anywhere]">{action.confirmation}</p>}

        {action.status === 'proposed' &&
          wrap(
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onDecide('approve')}
                className="flex h-control-sm flex-1 items-center justify-center gap-1 rounded bg-accent-500 px-3 text-xs font-semibold text-white hover:bg-accent-600"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                type="button"
                onClick={() => onDecide('reject')}
                className="flex h-control-sm flex-1 items-center justify-center gap-1 rounded border border-border-default bg-surface px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary"
              >
                <XCircle className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          )}

        {action.status === 'approving' && (
          <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {action.decision === 'reject' ? 'Rejecting…' : 'Executing…'}
          </p>
        )}

        {action.status === 'approved' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-green-500/10 px-2.5 py-2 text-xs text-green-700 dark:text-green-400">
            <span className="flex min-w-0 flex-1 items-start gap-1.5">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-semibold">Executed</span>
                {outcome?.text ? ` — ${outcome.text}` : ''}
              </span>
            </span>
            {outcome?.href && (
              <Link href={adminHref(outcome.href)} className="inline-flex shrink-0 items-center gap-0.5 font-semibold hover:underline">
                {outcome.linkLabel ?? 'Open'} <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}

        {action.status === 'failed' && (
          <div className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-xs text-red-600 dark:text-red-400">
            <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">Failed</span> — {action.error || 'unknown error'}
            </span>
          </div>
        )}

        {action.status === 'rejected' && (
          <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <Ban className="h-3.5 w-3.5" /> Rejected — nothing was changed
          </p>
        )}
      </div>
    </div>
  )
}
