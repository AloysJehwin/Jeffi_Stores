'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { VERDICT_LABEL, type DocAnalysis } from '@controller/lib/kyb/extract'
import { analysisProblem } from '@controller/lib/kyb/requirements'
import { FileField } from './CompliancePanel'
import { Badge, fieldInput, fieldLabel } from './ui'
import { needsNote, type KybUpload } from './kyb'

// A KYB document in the Business and GST steps: the upload, then what the automatic check found (read off the file and
// compared with the answers), so the owner can fix a typo or upload a clearer copy. A mismatch doesn't block the
// application: the owner can say they checked it and explain, and a reviewer sees that note.

const TONE = { verified: 'sage', review: 'peach', mismatch: 'red', unreadable: 'red' } as const
const errCls = 'text-xs text-[#8a2e1f]'
const linkBtn = 'inline-flex min-h-11 items-center font-semibold text-foreground underline disabled:opacity-40 disabled:no-underline sm:min-h-0'

/** The check's finding in a line: the failing check, else what a reviewer will look at. */
function finding(a: DocAnalysis): string {
  if (a.verdict === 'verified') return 'It matches what you entered.'
  return analysisProblem(a) ?? a.checks.find(c => c.status === 'warn')?.message ?? ''
}

export default function KybDocField({
  id,
  label,
  hint,
  upload,
  current,
  checking,
  error,
  blocked,
  onUpload,
  onRemove,
  onCheck,
  onPatch,
}: {
  id: string
  label: string
  hint?: string
  upload: KybUpload | undefined
  /** False when the answers changed after the check. */
  current: boolean
  checking: boolean
  /** The check didn't run (too many, network). */
  error: string | null
  /** Why it can't be checked yet. */
  blocked: string | null
  onUpload: (f: File) => Promise<void>
  onRemove: () => void
  onCheck: () => void
  onPatch: (patch: Partial<KybUpload>) => void
}) {
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const uploaded = !!upload?.s3Key
  const a = upload?.analysis
  const status = upload?.status
  // A document on file that Jeffi already decided on: its check no longer matters.
  const settled = status === 'approved' || status === 'rejected' || status === 'expired'

  return (
    <div>
      <FileField
        id={id}
        label={label}
        fileName={uploaded ? upload!.fileName || 'Uploaded' : null}
        onRemove={() => {
          setUploadErr(null)
          onRemove()
        }}
        onFile={async f => {
          setUploadErr(null)
          try {
            await onUpload(f)
          } catch (e) {
            setUploadErr((e as Error).message)
          }
        }}
      />
      {uploadErr && <p className={`${errCls} mt-1`}>{uploadErr}</p>}
      {!uploaded && !uploadErr && hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}

      {uploaded && (
        <div className="mt-2 space-y-2 text-xs" aria-live="polite">
          {status === 'approved' ? (
            <Badge tone="sage">Verified by Jeffi</Badge>
          ) : status === 'rejected' || status === 'expired' ? (
            <p className={errCls}>{status === 'expired' ? 'This document has expired. Upload the renewed one.' : 'Jeffi couldn’t accept this document. Upload it again.'}</p>
          ) : checking ? (
            <p className="flex items-center gap-2 text-foreground-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
            </p>
          ) : error ? (
            <p className={errCls}>
              {error}{' '}
              <button type="button" onClick={onCheck} disabled={!!blocked} title={blocked ?? undefined} className={linkBtn}>
                Try again
              </button>
            </p>
          ) : a ? (
            <div className={`space-y-1 ${current ? '' : 'opacity-60'}`}>
              <Badge tone={TONE[a.verdict]}>{VERDICT_LABEL[a.verdict]}</Badge>
              {finding(a) && <p className="text-foreground-secondary">{finding(a)}</p>}
            </div>
          ) : a === null ? (
            <p className="text-foreground-secondary">
              We couldn’t read this file automatically. Upload a sharper copy, or leave it for a reviewer.{' '}
              <button type="button" onClick={onCheck} disabled={!!blocked} title={blocked ?? undefined} className={linkBtn}>
                Try again
              </button>
            </p>
          ) : blocked ? (
            <p className="text-foreground-muted">{blocked}</p>
          ) : (
            <p className="text-foreground-muted">
              Not checked yet.{' '}
              <button type="button" onClick={onCheck} className={linkBtn}>
                Check now
              </button>
            </p>
          )}

          {!settled && a && !current && !checking && (
            <p className="text-foreground-secondary">
              You changed your details after this check.{' '}
              <button type="button" onClick={onCheck} disabled={!!blocked} title={blocked ?? undefined} className={linkBtn}>
                Check again
              </button>
            </p>
          )}

          {!settled && needsNote(upload) && current && !checking && (
            <div className="space-y-2 rounded-xl border border-border-default bg-surface p-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded accent-accent-600" checked={!!upload?.ack} onChange={e => onPatch({ ack: e.target.checked })} />
                <span>I’ve checked this: the document is correct</span>
              </label>
              {upload?.ack && (
                <div>
                  <label htmlFor={`${id}-note`} className={fieldLabel}>
                    What’s different, and why
                  </label>
                  <textarea
                    id={`${id}-note`}
                    className={`${fieldInput} h-20 resize-none`}
                    maxLength={1000}
                    placeholder="For example: the certificate still shows our old name; we changed it in March 2026."
                    value={upload.note ?? ''}
                    onChange={e => onPatch({ note: e.target.value })}
                  />
                  {(upload.note ?? '').trim().length < 10 && <p className="mt-1 text-foreground-muted">A sentence or two for the reviewer.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
