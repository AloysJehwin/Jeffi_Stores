'use client'

import { useMemo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '@/components/admin/kit/dialog'
import EcomDialogShell from './EcomDialogShell'

export interface ResetToPlatformSnapshot {
  body: string
  subject?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
  channel: 'email' | 'sms' | 'whatsapp'
  current: ResetToPlatformSnapshot
  platform: ResetToPlatformSnapshot
  /** Admin uses the kit Dialog; ecom uses the EcomDialogShell so the cream/terracotta tokens apply. */
  theme?: 'admin' | 'ecom'
}

interface DiffLine {
  key: string
  tag: ' ' | '-' | '+'
  text: string
}

// Simple longest-common-subsequence line diff; small enough for a template body (dozens of lines).
function diffLines(a: string, b: string): DiffLine[] {
  const left = a.split('\n')
  const right = b.split('\n')
  const n = left.length
  const m = right.length
  // Build LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let k = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ key: `c${k++}`, tag: ' ', text: left[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ key: `c${k++}`, tag: '-', text: left[i++] })
    } else {
      out.push({ key: `c${k++}`, tag: '+', text: right[j++] })
    }
  }
  while (i < n) out.push({ key: `c${k++}`, tag: '-', text: left[i++] })
  while (j < m) out.push({ key: `c${k++}`, tag: '+', text: right[j++] })
  return out
}

function MonoBlock({ title, text, tone }: { title: string; text: string; tone: 'current' | 'platform' }) {
  const ring = tone === 'current' ? 'ring-rose-500/20' : 'ring-emerald-500/20'
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">{title}</div>
      <pre
        className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-secondary px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground ring-1 ${ring}`}
      >
        {text || <em className="not-italic text-foreground-muted">empty</em>}
      </pre>
    </div>
  )
}

function DiffPanel({ current, platform }: { current: string; platform: string }) {
  const lines = useMemo(() => diffLines(current, platform), [current, platform])
  return (
    <div className="rounded-md border border-border-default bg-surface">
      <div className="border-b border-border-default px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        Per-line diff
      </div>
      <pre className="max-h-72 overflow-auto px-0 py-1 font-mono text-[11px] leading-snug">
        {lines.map(l => {
          const bg =
            l.tag === '-'
              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
              : l.tag === '+'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'text-foreground-secondary'
          return (
            <div key={l.key} className={`px-3 ${bg}`}>
              <span className="select-none text-foreground-muted">{l.tag}</span> {l.text || ' '}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

/** Diff + warning gate before overwriting a tenant's forked body with the platform default. */
export default function ResetToPlatformDialog({ open, onClose, onConfirm, busy, channel, current, platform, theme = 'admin' }: Props) {
  const bannerBody = (
    <>
      The platform catalogue was updated — resetting replaces your copy with the new wording.
      {channel === 'whatsapp' && <> <code className="font-mono">{'{{brand_name}}'}</code> is filled with your store name on every send.</>}
    </>
  )
  const subjectChanged = channel === 'email' && (current.subject ?? '') !== (platform.subject ?? '')

  const body = (
    <div className="space-y-4">
      <Banner>{bannerBody}</Banner>
      {subjectChanged && (
        <div className="grid gap-3 sm:grid-cols-2">
          <MonoBlock title="Current subject" text={current.subject ?? ''} tone="current" />
          <MonoBlock title="Platform subject" text={platform.subject ?? ''} tone="platform" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <MonoBlock title="Current body" text={current.body} tone="current" />
        <MonoBlock title="Platform body" text={platform.body} tone="platform" />
      </div>
      <DiffPanel current={current.body} platform={platform.body} />
    </div>
  )

  const resetBtnCls =
    theme === 'ecom'
      ? 'ecom-accent-bg inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white disabled:opacity-60'
      : 'inline-flex h-control items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-60'
  const cancelBtnCls =
    theme === 'ecom'
      ? 'inline-flex h-9 items-center rounded-full border border-border-default bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-secondary'
      : 'inline-flex h-control items-center rounded-lg border border-border-secondary bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-secondary'

  const footer = (
    <>
      <button type="button" onClick={onClose} className={cancelBtnCls} disabled={busy}>
        Cancel
      </button>
      <button type="button" onClick={onConfirm} className={resetBtnCls} disabled={busy}>
        Reset to platform default
      </button>
    </>
  )

  const title = 'Reset to platform default'
  const description = 'Review the changes before overwriting this store’s copy.'

  if (theme === 'ecom') {
    return (
      <EcomDialogShell open={open} onClose={onClose} title={title} description={description} footer={footer}>
        {body}
      </EcomDialogShell>
    )
  }
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="lg" footer={footer}>
      {body}
    </Dialog>
  )
}
