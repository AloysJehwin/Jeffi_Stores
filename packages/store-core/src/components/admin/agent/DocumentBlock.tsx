'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, FileText } from 'lucide-react'
import { badgeCls } from '../kit/tones'
import { adminHref, arr, fmtINR, fmtPct, fmtQty, humanizeKind, KIT_TONE, parseNumber, toneOf, type BlockTone } from './format'

// Any document preview (quotation, invoice, order, refund, PO): header, parties, meta,
// line items as a list that reads at chat width, totals, notes.

export interface DocumentLine {
  name: string
  sku?: string | null
  variant?: string | null
  href?: string | null
  qty: number
  unit?: string | null
  /** e.g. '= 50 pcs' */
  baseQty?: string | null
  rate?: number | null
  /** e.g. 'per pc' */
  rateNote?: string | null
  discountPct?: number | null
  taxPct?: number | null
  amount: number
  warning?: string | null
}

export interface DocumentBlockData {
  type: 'document'
  kind: string
  title: string
  subtitle?: string | null
  status?: { label: string; tone?: BlockTone }
  parties?: Array<{ label: string; name: string; lines?: string[] }>
  meta?: Array<{ key: string; value: string }>
  lines: DocumentLine[]
  totals: Array<{ key: string; value: number; emphasis?: boolean }>
  notes?: string | null
  footnote?: string | null
}

const COLLAPSE_AT = 8
const label = 'text-[10px] font-semibold uppercase tracking-wide text-foreground-muted'

function rateSuffix(note?: string | null): string {
  const n = (note || '').trim()
  if (!n) return ''
  return /^per\s+/i.test(n) ? `/${n.replace(/^per\s+/i, '')}` : ` ${n}`
}

function lineDetail(l: DocumentLine): string {
  let s = `${fmtQty(l.qty)}${l.unit ? ` ${l.unit}` : ''}`
  if (l.baseQty) s += /^[=≈(]/.test(l.baseQty.trim()) ? ` ${l.baseQty.trim()}` : ` · ${l.baseQty}`
  const rate = parseNumber(l.rate)
  if (rate != null) s += ` × ${fmtINR(rate)}${rateSuffix(l.rateNote)}`
  return s
}

export default function DocumentBlock({ block }: { block: DocumentBlockData }) {
  const [expanded, setExpanded] = useState(false)
  const parties = arr(block.parties)
  const meta = arr(block.meta)
  const lines = arr(block.lines)
  const totals = arr(block.totals)
  const shown = expanded || lines.length <= COLLAPSE_AT ? lines : lines.slice(0, COLLAPSE_AT - 2)
  const kindLabel = humanizeKind(block.kind)

  return (
    <div className="max-w-2xl overflow-hidden rounded-xl border border-border-default bg-surface-elevated text-xs text-foreground">
      <div className="flex items-start gap-2.5 border-b border-border-default px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-600 dark:text-accent-400">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {kindLabel && kindLabel.toLowerCase() !== String(block.title || '').toLowerCase() && <p className={label}>{kindLabel}</p>}
          <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{block.title}</p>
          {block.subtitle && <p className="mt-0.5 text-foreground-muted [overflow-wrap:anywhere]">{block.subtitle}</p>}
        </div>
        {block.status?.label && <span className={`${badgeCls(KIT_TONE[toneOf(block.status.tone)])} shrink-0`}>{block.status.label}</span>}
      </div>

      {parties.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-border-default px-3 py-2.5">
          {parties.map((p, i) => (
            <div key={i} className="min-w-[9rem] flex-1">
              <p className={label}>{p.label}</p>
              <p className="mt-0.5 font-medium [overflow-wrap:anywhere]">{p.name}</p>
              {arr(p.lines).map((l, j) => (
                <p key={j} className="text-foreground-muted [overflow-wrap:anywhere]">
                  {l}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {meta.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border-default bg-surface-secondary px-3 py-2">
          {meta.map((m, i) => (
            <div key={i} className="flex min-w-0 gap-1">
              <dt className="shrink-0 text-foreground-muted">{m.key}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {lines.length > 0 && (
        <>
          <div className={`flex items-center justify-between px-3 pb-1 pt-2 ${label}`}>
            <span>
              {lines.length} item{lines.length === 1 ? '' : 's'}
            </span>
            <span>Amount</span>
          </div>
          <ol className="divide-y divide-border-default">
            {shown.map((l, i) => {
              const disc = parseNumber(l.discountPct)
              const tax = parseNumber(l.taxPct)
              const name = <span className="font-medium leading-snug [overflow-wrap:anywhere]">{l.name}</span>
              return (
                <li key={i} className="flex items-start gap-2 px-3 py-2">
                  <span className="w-4 shrink-0 pt-px text-[10px] tabular-nums text-foreground-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      {l.href ? (
                        <Link href={adminHref(l.href)} className="min-w-0 hover:text-accent-600 hover:underline dark:hover:text-accent-400">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      <span className="shrink-0 font-semibold tabular-nums">{fmtINR(l.amount)}</span>
                    </div>
                    {(l.variant || l.sku) && (
                      <p className="mt-0.5 text-[10px] text-foreground-muted [overflow-wrap:anywhere]">
                        {l.variant}
                        {l.variant && l.sku ? ' · ' : ''}
                        {l.sku && <span className="font-mono">{l.sku}</span>}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="tabular-nums text-foreground-secondary">{lineDetail(l)}</span>
                      {disc != null && disc > 0 && <span className={badgeCls('green')}>{fmtPct(disc)} off</span>}
                      {tax != null && <span className={badgeCls('muted')}>GST {fmtPct(tax)}</span>}
                    </div>
                    {l.warning && (
                      <p className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="[overflow-wrap:anywhere]">{l.warning}</span>
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          {lines.length > COLLAPSE_AT && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="w-full border-t border-border-default px-3 py-1.5 text-left text-[11px] font-medium text-accent-600 hover:bg-surface-secondary dark:text-accent-400"
            >
              {expanded ? 'Show fewer' : `Show all ${lines.length} items`}
            </button>
          )}
        </>
      )}

      {totals.length > 0 && (
        <div className="border-t border-border-default px-3 py-2.5">
          <div className="ml-auto max-w-[16rem] space-y-1">
            {totals.map((t, i) =>
              t.emphasis ? (
                <div key={i} className={`flex justify-between gap-6 ${i > 0 ? 'mt-1.5 border-t border-border-default pt-1.5' : ''}`}>
                  <span className="font-semibold">{t.key}</span>
                  <span className="text-sm font-bold tabular-nums">{fmtINR(t.value)}</span>
                </div>
              ) : (
                <div key={i} className="flex justify-between gap-6">
                  <span className="text-foreground-muted">{t.key}</span>
                  <span className="tabular-nums">{fmtINR(t.value)}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {block.notes && (
        <div className="border-t border-border-default px-3 py-2">
          <p className={label}>Notes</p>
          <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{block.notes}</p>
        </div>
      )}
      {block.footnote && (
        <p className="border-t border-border-default bg-surface-secondary px-3 py-1.5 text-[10px] text-foreground-muted [overflow-wrap:anywhere]">
          {block.footnote}
        </p>
      )}
    </div>
  )
}
