import type { LucideIcon } from 'lucide-react'
import { CircleCheck, CircleQuestionMark, CircleX, TriangleAlert } from 'lucide-react'
import { StatusBadge, humanize, type StatusMap } from '@/components/admin/kit/status'
import { VERDICT_LABEL, type CheckStatus, type DocCheck as Check } from '@controller/lib/kyb/extract'
import type { KybDocView } from '@controller/lib/kyb/view'
import { Mono } from '../EcomUI'
import { dateIN, dateTimeIN } from '../cells'

// A document on file (a selling licence or a KYB document) as the KYC tab shows it.

/** A document with what reviewing it needs beyond the KYB view: its file (the review's version) and who decided on it. */
export type DocFile = KybDocView & { version: string; reviewedBy: string | null; reviewedAt: string | null }

export const DOC_STATUS: StatusMap = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
}

/** Who decided on a document and when, with the note the owner sees. */
export function reviewLine(d: { status: string; reviewedAt: string | null; reviewedBy: string | null; reviewNote: string | null }): string | undefined {
  if (!d.reviewedAt) return d.reviewNote ?? undefined
  const what = d.status === 'rejected' ? 'Rejected' : 'Approved'
  return `${what} by ${d.reviewedBy ?? 'an admin'} on ${dateIN(d.reviewedAt)}${d.reviewNote ? `: ${d.reviewNote}` : ''}`
}

const VERDICT: StatusMap = {
  verified: { label: VERDICT_LABEL.verified, tone: 'green' },
  review: { label: VERDICT_LABEL.review, tone: 'amber' },
  mismatch: { label: VERDICT_LABEL.mismatch, tone: 'red' },
  unreadable: { label: VERDICT_LABEL.unreadable, tone: 'red' },
  checking: { label: 'Being checked', tone: 'blue' },
  failed: { label: 'Couldn’t be checked', tone: 'amber' },
  stale: { label: 'Out of date', tone: 'amber' },
}

const STATUS: Record<CheckStatus, { icon: LucideIcon; cls: string; label: string }> = {
  pass: { icon: CircleCheck, cls: 'text-green-600 dark:text-green-400', label: 'Passed' },
  warn: { icon: TriangleAlert, cls: 'text-amber-600 dark:text-amber-400', label: 'Close' },
  fail: { icon: CircleX, cls: 'text-red-600 dark:text-red-400', label: 'Failed' },
  missing: { icon: CircleQuestionMark, cls: 'text-foreground-muted', label: 'Not found' },
}

const CHECKED: Record<string, string> = { number: 'Number', name: 'Name', expiry: 'Expiry', constitution: 'Constitution', document: 'Document' }

const READ: Record<string, string> = {
  number: 'Number',
  name: 'Name',
  validUntil: 'Valid until',
  tradeName: 'Trade name',
  constitution: 'Constitution',
  address: 'Address',
  date: 'Date of birth or incorporation',
}

const ENGINE: Record<string, string> = {
  pdf: 'Read from the PDF’s text',
  paddleocr: 'Read by PaddleOCR',
  vision: 'Read by the vision model',
}

const norm = (v?: string) => (v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

function CheckLine({ c }: { c: Check }) {
  const s = STATUS[c.status] ?? STATUS.missing
  const Icon = s.icon
  const value = (v: string) => (c.field === 'number' ? <Mono>{v}</Mono> : <span className="text-foreground">{v}</span>)
  const pair = (c.expected || c.found) && !(c.status === 'pass' && norm(c.expected) === norm(c.found))
  return (
    <li className="flex items-start gap-1.5 min-w-0">
      <Icon aria-hidden className={`mt-px h-3.5 w-3.5 shrink-0 ${s.cls}`} />
      <div className="min-w-0 break-words">
        <span className="sr-only">{s.label}: </span>
        <span className="font-medium text-foreground">{CHECKED[c.field] ?? humanize(c.field)}</span>
        <span className="text-foreground-secondary"> · {c.message}</span>
        {pair && (
          <div className="text-foreground-muted">
            {c.expected && <>Expected {value(c.expected)}</>}
            {c.expected && c.found && ' · '}
            {c.found && (
              <>
                {c.expected ? 'found' : 'Found'} {value(c.found)}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * A document's automatic check (lib/kyb/extract.ts): the verdict, each comparison with what the owner gave, and what
 * was read off the document. Nothing for a document that was never checked and carries no note.
 */
export default function DocCheck({ doc }: { doc: Pick<KybDocView, 'analysis' | 'analysisStatus' | 'current' | 'ownerNote'> }) {
  const checking = doc.analysisStatus === 'pending'
  const failed = doc.analysisStatus === 'failed'
  // While it runs again, the previous result is about to be replaced.
  const a = checking ? null : doc.analysis
  if (!a && !checking && !failed && !doc.ownerNote) return null
  const checks = a?.checks ?? []
  const fields = Object.entries(a?.fields ?? {}).filter(([, v]) => v)
  const lines = checks.map((c, i) => <CheckLine key={i} c={c} />)

  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-xs min-w-0">
      {(a || checking || failed) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">Automatic check</span>
          <StatusBadge status={checking ? 'checking' : failed ? 'failed' : a?.verdict} map={VERDICT} />
          {a && !doc.current && <StatusBadge status="stale" map={VERDICT} title="The business’s answers changed after this check. Run the checks again." />}
          {a && (
            <span className="text-foreground-muted">
              {ENGINE[a.engine ?? ''] ?? (a.source === 'text' ? ENGINE.pdf : 'Read by OCR')} · {dateTimeIN(a.analyzedAt)}
            </span>
          )}
        </div>
      )}
      {failed && <p className="mt-1 text-foreground-muted">The file couldn’t be read automatically. Open it and check it yourself.</p>}
      {lines.length > 0 &&
        (a?.verdict === 'verified' ? (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-foreground-muted hover:text-foreground">
              {lines.length === 1 ? 'The check passed' : `All ${lines.length} checks passed`}
            </summary>
            <ul className="mt-1 space-y-1">{lines}</ul>
          </details>
        ) : (
          <ul className="mt-1.5 space-y-1">{lines}</ul>
        ))}
      {fields.length > 0 && (
        <div className="mt-1.5 min-w-0">
          <div className="text-foreground-muted">Read off the document</div>
          <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 min-w-0">
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0 break-words">
                <dt className="inline text-foreground-muted">{READ[k] ?? humanize(k)}: </dt>
                <dd className="inline text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {doc.ownerNote && (
        <p className={`break-words whitespace-pre-line ${a || checking || failed ? 'mt-1.5' : ''}`}>
          <span className="font-medium text-foreground">Owner’s note: </span>
          <span className="text-foreground-secondary">{doc.ownerNote}</span>
        </p>
      )}
    </div>
  )
}
