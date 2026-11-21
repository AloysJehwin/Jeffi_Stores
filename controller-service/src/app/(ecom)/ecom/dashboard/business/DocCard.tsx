'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, MinusCircle, RotateCcw, Trash2, Upload, XCircle } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useToast } from '@/contexts/ToastContext'
import { VERDICT_LABEL, type CheckStatus } from '@controller/lib/kyb/extract'
import { KYB_DOCS, docNumberProblem, formatDocNumber } from '@controller/lib/kyb/requirements'
import type { KybDocView, KybView } from '@controller/lib/kyb/view'
import { Badge, fieldInput, fieldLabel, ghostBtn, primaryBtn, secondaryBtn } from '../../onboard/ui'
import { kybCall } from './api'

// One KYB document: the file on record and what its automatic check found, with upload, view, explain and remove.

const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const errCls = 'mt-1 text-xs text-[#8a2e1f]'
const noteBox = 'mt-3 rounded-xl px-3.5 py-2.5 text-sm'

type Tone = 'sage' | 'peach' | 'red' | 'muted'

const CHECK: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  pass: { Icon: CheckCircle2, cls: 'org-sage-text', label: 'Matches' },
  warn: { Icon: AlertTriangle, cls: 'org-brown', label: 'For a reviewer' },
  fail: { Icon: XCircle, cls: 'text-[#8a2e1f]', label: 'Doesn’t match' },
  missing: { Icon: MinusCircle, cls: 'text-foreground-muted', label: 'Not found' },
}

const dayOf = (v: string | Date) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function docPill(d: KybDocView): { label: string; tone: Tone; busy?: boolean } {
  if (d.status === 'approved') return { label: 'Approved', tone: 'sage' }
  if (d.status === 'rejected') return { label: 'Not accepted', tone: 'red' }
  if (d.status === 'expired') return { label: 'Expired', tone: 'red' }
  if (d.analysisStatus === 'pending') return { label: 'Checking…', tone: 'muted', busy: true }
  if (d.analysisStatus === 'failed') return { label: 'Couldn’t check automatically, a reviewer will', tone: 'peach' }
  const v = d.analysis?.verdict
  if (!v) return { label: 'Waiting for a reviewer', tone: 'peach' }
  return { label: VERDICT_LABEL[v], tone: v === 'verified' ? 'sage' : v === 'review' ? 'peach' : 'red' }
}

export default function DocCard({
  docType,
  doc,
  blocked,
  removable = false,
  note,
  today,
  stalled = false,
  onKyb,
}: {
  docType: string
  doc?: KybDocView
  /** Why it can't be uploaded yet. */
  blocked?: string | null
  removable?: boolean
  /** Context from the section, such as a proof that doesn't suit the business type. */
  note?: string | null
  today: string
  /** Polling stopped while the check was still running. */
  stalled?: boolean
  onKyb: (kyb: KybView) => void
}) {
  const confirm = useConfirm()
  const { showToast } = useToast()
  const [replacing, setReplacing] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [ownerNote, setOwnerNote] = useState('')
  const [busy, setBusy] = useState<'upload' | 'note' | 'remove' | 'recheck' | null>(null)
  const [number, setNumber] = useState(doc?.number ?? '')
  const [numberLeft, setNumberLeft] = useState(false)
  const [expiresOn, setExpiresOn] = useState(doc?.expiresOn ?? '')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const spec = KYB_DOCS[docType]
  if (!spec) return null

  const id = `kyb-doc-${docType}`
  const name = spec.label.replace(/\s*\([^)]*\)$/, '')
  // The PAN card and GST certificate are checked against the PAN and GSTIN saved above; proofs carry their own number.
  const withNumber = docType !== 'pan_card' && docType !== 'gst_cert' && !!spec.numberLabel
  const numberProblem = !withNumber
    ? null
    : !number.trim()
      ? docType === 'partnership_deed'
        ? null
        : `Enter the ${spec.numberLabel?.replace(/^Registration/, 'registration')}.`
      : docNumberProblem(docType, number)
  const numberError = errors.number || (numberLeft ? numberProblem : null)
  const showForm = !doc || replacing
  const pill = doc ? docPill(doc) : null
  const verdict = doc?.analysis?.verdict
  const settled = !!doc && doc.status !== 'approved' && doc.analysisStatus !== 'pending'
  const urgent = !!doc && (doc.status === 'rejected' || doc.status === 'expired' || ((verdict === 'mismatch' || verdict === 'unreadable') && !doc.ownerNote && doc.analysisStatus !== 'pending'))
  const canExplain = !!doc && doc.status === 'pending' && doc.analysisStatus !== 'pending' && (verdict === 'mismatch' || verdict === 'unreadable') && !doc.ownerNote
  const canRecheck = !!doc && doc.status !== 'approved' && (doc.analysisStatus === 'failed' || (settled && !!doc.analysis && !doc.current) || (stalled && doc.analysisStatus === 'pending'))

  async function startReplace() {
    if (doc?.status === 'approved') {
      const ok = await confirm({ title: `Replace your ${name}?`, message: 'This one is approved. The new copy goes back to review and is checked again.', confirmLabel: 'Replace' })
      if (!ok) return
    }
    setNumber(doc?.number ?? '')
    setExpiresOn(doc?.expiresOn ?? '')
    setErrors({})
    setReplacing(true)
  }

  async function upload(file: File) {
    setNumberLeft(true)
    if (numberProblem) return setErrors({ number: numberProblem })
    if (file.size > MAX_BYTES) return setErrors({ file: 'The file is over 5 MB. Upload a smaller copy.' })
    if (!TYPES.includes(file.type)) return setErrors({ file: 'Upload a PDF, JPG, PNG or WebP file.' })
    setBusy('upload')
    setErrors({})
    const fd = new FormData()
    fd.append('file', file)
    fd.append('docType', docType)
    if (withNumber && number.trim()) fd.append('number', number.trim())
    if (spec.expires && expiresOn) fd.append('expiresOn', expiresOn)
    const r = await kybCall('/api/ecom/kyb/documents', { method: 'POST', body: fd })
    setBusy(null)
    if (!r.ok) {
      const { number: n, expiresOn: e } = r.fields
      return setErrors({ number: n, expiresOn: e, file: n || e ? undefined : r.error })
    }
    setReplacing(false)
    setNumberLeft(false)
    onKyb(r.kyb)
    showToast(`${name} uploaded.`, 'success')
  }

  async function sendNote() {
    if (ownerNote.trim().length < 10) return setErrors({ ownerNote: 'Explain in a sentence or two.' })
    setBusy('note')
    const r = await kybCall(`/api/ecom/kyb/documents/${docType}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerNote: ownerNote.trim() }) })
    setBusy(null)
    if (!r.ok) return setErrors({ ownerNote: r.fields.ownerNote ?? r.error })
    setExplaining(false)
    setOwnerNote('')
    setErrors({})
    onKyb(r.kyb)
    showToast(`${name} sent to a reviewer with your note.`, 'success')
  }

  async function remove() {
    const ok = await confirm({ title: `Remove the ${name}?`, message: 'It comes off your business verification. You can upload another one afterwards.', confirmLabel: 'Remove', variant: 'danger' })
    if (!ok) return
    setBusy('remove')
    const r = await kybCall(`/api/ecom/kyb/documents/${docType}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) return showToast(r.error, 'error')
    onKyb(r.kyb)
    showToast(`${name} removed.`, 'success')
  }

  async function recheck() {
    setBusy('recheck')
    const r = await kybCall('/api/ecom/kyb/recheck', { method: 'POST' })
    setBusy(null)
    if (!r.ok) return showToast(r.error, 'error')
    onKyb(r.kyb)
  }

  return (
    <div id={id} className="rounded-xl border border-border-default bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-foreground">{spec.label}</h3>
          {doc ? (
            <p className="mt-0.5 break-words text-xs text-foreground-muted">
              {doc.fileName || 'File on record'} · Uploaded {dayOf(doc.uploadedAt)}
              {withNumber && doc.number && (
                <>
                  {' · '}
                  {spec.numberLabel?.split(',')[0]} <span className="font-mono text-foreground-secondary">{doc.number}</span>
                </>
              )}
              {doc.expiresOn && <> · Valid until {dateOf(doc.expiresOn)}</>}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-foreground-muted">{spec.hint}</p>
          )}
        </div>
        <div aria-live="polite" className="flex flex-wrap items-center gap-1.5">
          {pill && (
            <Badge tone={pill.tone}>
              {pill.busy && <Loader2 aria-hidden className="mr-1 h-3 w-3 animate-spin" />}
              {pill.label}
            </Badge>
          )}
          {doc?.ownerNote && doc.status === 'pending' && <Badge tone="muted">Sent for review</Badge>}
        </div>
      </div>

      {note && <p className="mt-2 text-sm text-[#8a2e1f]">{note}</p>}

      {settled && doc?.analysis && doc.analysis.checks.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label="What the check found">
          {doc.analysis.checks.map((c, i) => {
            const k = CHECK[c.status] ?? CHECK.missing
            return (
              <li key={`${c.field}-${i}`} className="flex items-start gap-2 text-sm">
                <k.Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${k.cls}`} />
                <span className="min-w-0 break-words text-foreground-secondary">
                  <span className="sr-only">{k.label}: </span>
                  {c.message}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {settled && doc?.analysis && !doc.current && <p className="mt-2 text-xs text-foreground-muted">Your business details changed after this check.</p>}
      {stalled && doc?.analysisStatus === 'pending' && <p className="mt-2 text-xs text-foreground-muted">This is taking longer than usual.</p>}

      {doc?.status === 'rejected' && (
        <div className={`${noteBox} bg-[#f2d4cd] text-[#8a2e1f]`}>
          <span className="font-semibold">Why it was not accepted: </span>
          {doc.reviewNote || 'Upload a clear, complete and current copy.'}
        </div>
      )}
      {doc && doc.status !== 'rejected' && doc.reviewNote && (
        <div className={`${noteBox} bg-surface-secondary text-foreground-secondary`}>
          <span className="font-semibold">Note from our review: </span>
          {doc.reviewNote}
        </div>
      )}
      {doc?.ownerNote && (
        <div className={`${noteBox} bg-surface-secondary text-foreground-secondary`}>
          <span className="font-semibold">Your note for the reviewer: </span>
          {doc.ownerNote}
        </div>
      )}

      {explaining && (
        <div className="mt-4 space-y-2">
          <label htmlFor={`${id}-note`} className={fieldLabel}>
            Why is this document right?
          </label>
          <textarea
            id={`${id}-note`}
            rows={3}
            maxLength={1000}
            className={fieldInput}
            value={ownerNote}
            placeholder="For example: the business changed its name in 2024 and the certificate still shows the old one."
            aria-invalid={!!errors.ownerNote || undefined}
            aria-describedby={errors.ownerNote ? `${id}-note-error` : `${id}-note-hint`}
            onChange={e => {
              setOwnerNote(e.target.value)
              setErrors(v => ({ ...v, ownerNote: undefined }))
            }}
          />
          {errors.ownerNote ? (
            <p id={`${id}-note-error`} className={errCls}>
              {errors.ownerNote}
            </p>
          ) : (
            <p id={`${id}-note-hint`} className="text-xs text-foreground-muted">
              A reviewer reads this with the document as it is.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} disabled={busy === 'note'} onClick={sendNote}>
              {busy === 'note' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {busy === 'note' ? 'Sending…' : 'Send for review'}
            </button>
            <button
              type="button"
              className={ghostBtn}
              disabled={busy === 'note'}
              onClick={() => {
                setExplaining(false)
                setErrors({})
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showForm &&
        (blocked ? (
          <p className="mt-3 rounded-xl bg-surface-secondary px-3.5 py-2.5 text-sm text-foreground-secondary">{blocked}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {doc && <p className="text-xs text-foreground-muted">{spec.hint}</p>}
            {(withNumber || spec.expires) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {withNumber && (
                  <div>
                    <label htmlFor={`${id}-number`} className={fieldLabel}>
                      {spec.numberLabel}
                    </label>
                    <input
                      id={`${id}-number`}
                      className={fieldInput}
                      value={number}
                      maxLength={64}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!numberError || undefined}
                      aria-describedby={numberError ? `${id}-number-error` : undefined}
                      onChange={e => {
                        setNumber(e.target.value.toUpperCase())
                        setErrors(v => ({ ...v, number: undefined }))
                      }}
                      onBlur={e => {
                        setNumberLeft(true)
                        if (e.target.value.trim()) setNumber(formatDocNumber(docType, e.target.value))
                      }}
                    />
                    {numberError && (
                      <p id={`${id}-number-error`} className={errCls}>
                        {numberError}
                      </p>
                    )}
                  </div>
                )}
                {spec.expires && (
                  <div>
                    <span className={fieldLabel}>
                      Valid until <span className="font-normal text-foreground-muted">(if it has an expiry date)</span>
                    </span>
                    <DatePicker
                      aria-label="Valid until"
                      className="w-full"
                      triggerClassName={fieldInput}
                      placeholder="Pick a date"
                      min={today}
                      value={expiresOn}
                      clearable
                      onChange={v => {
                        setExpiresOn(v)
                        setErrors(e => ({ ...e, expiresOn: undefined }))
                      }}
                    />
                    {errors.expiresOn && <p className={errCls}>{errors.expiresOn}</p>}
                  </div>
                )}
              </div>
            )}
            <div>
              <label
                className={`ecom-field flex min-h-11 items-center justify-center gap-2 rounded-xl border-dashed bg-surface px-3 py-2 text-sm text-foreground-secondary transition-colors ${busy === 'upload' ? 'cursor-wait' : 'cursor-pointer hover:text-foreground'}`}
              >
                {busy === 'upload' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Upload aria-hidden className="h-4 w-4" />}
                {busy === 'upload' ? 'Uploading and checking…' : doc ? 'Choose the new file' : `Upload the ${name}`}
                <input
                  type="file"
                  className="sr-only"
                  accept={ACCEPT}
                  disabled={busy === 'upload'}
                  aria-describedby={`${id}-file-hint${errors.file ? ` ${id}-file-error` : ''}`}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) upload(f)
                  }}
                />
              </label>
              {errors.file && (
                <p id={`${id}-file-error`} className={errCls}>
                  {errors.file}
                </p>
              )}
              <p id={`${id}-file-hint`} className="mt-1 text-xs text-foreground-muted">
                PDF, JPG, PNG or WebP, up to 5 MB. It is checked as soon as it uploads, which can take up to 20 seconds.
              </p>
            </div>
            {replacing && (
              <button type="button" className={ghostBtn} disabled={busy === 'upload'} onClick={() => setReplacing(false)}>
                Cancel
              </button>
            )}
          </div>
        ))}

      {doc && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a href={`/api/ecom/compliance/${doc.id}`} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
            View <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
          {!replacing && !blocked && (
            <button type="button" className={urgent ? primaryBtn : secondaryBtn} disabled={!!busy} onClick={startReplace}>
              Upload again
            </button>
          )}
          {canExplain && !explaining && (
            <button type="button" className={secondaryBtn} disabled={!!busy} onClick={() => setExplaining(true)}>
              Explain and send for review
            </button>
          )}
          {canRecheck && (
            <button type="button" className={ghostBtn} disabled={!!busy} onClick={recheck}>
              {busy === 'recheck' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <RotateCcw aria-hidden className="h-4 w-4" />}
              Check again
            </button>
          )}
          {removable && doc.status !== 'approved' && (
            <button type="button" className={ghostBtn} disabled={!!busy} onClick={remove}>
              {busy === 'remove' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Trash2 aria-hidden className="h-4 w-4" />}
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}
