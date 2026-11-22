'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { Loader2, Upload } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { CheckMark } from '@controller/app/(ecom)/ecom/Shapes'
import { ChoiceChips } from '../_ui'
import { fieldInput, fieldLabel, fieldRow, noteCls } from './ui'
import {
  DOCS,
  RESTRICTED_ASK,
  RESTRICTED_MESSAGE,
  RESTRICTED_QUESTION,
  cleanDocNumber,
  compliancePlan,
  docProblem,
  todayIst,
  type ComplianceState,
  type ComplianceUpload,
} from '@controller/lib/catalog/compliance'

// The Store step's "Licences & certificates": what Indian law asks of stores selling the categories picked
// (lib/catalog/compliance.ts). Required documents and yes-answers each need a file, the number and, for licences that
// lapse, the expiry date; the wizard won't continue until they do, and submit checks again.

const MAX_BYTES = 5 * 1024 * 1024
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const errCls = 'text-xs text-[#8a2e1f]'

// Also the wizard's KYB documents and the console's Licences & certificates page (dashboard/licences), so all upload the same way.
export async function uploadKyc(file: File, docType?: string): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('That file is over 5 MB.')
  if (!TYPES.includes(file.type)) throw new Error('Upload a PDF, JPG, PNG or WebP file.')
  const fd = new FormData()
  fd.append('file', file)
  if (docType) fd.append('docType', docType)
  const res = await fetch('/api/ecom/onboard/kyc-upload', { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.s3Key) throw new Error(data.error || 'Upload failed. Try again.')
  return data.s3Key as string
}

export function FileField({ id, label, fileName, onFile, onRemove }: { id: string; label: string; fileName: string | null; onFile: (f: File) => Promise<void>; onRemove: () => void }) {
  const [busy, setBusy] = useState(false)
  if (fileName)
    return (
      <div>
        <span className={fieldLabel}>{label}</span>
        <div className={`flex items-center gap-2 rounded-xl border border-[var(--org-sage-deep)]/40 org-sage px-3 ${fieldRow}`}>
          <CheckMark className="h-4 w-4 shrink-0 org-sage-text" />
          <span className="min-w-0 flex-1 truncate text-sm org-sage-text">{fileName}</span>
          <button type="button" onClick={onRemove} className="shrink-0 text-xs text-foreground-muted hover:text-foreground">
            Remove
          </button>
        </div>
      </div>
    )
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <label className={`ecom-focus flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface px-3 text-sm text-foreground-secondary transition-colors hover:border-accent-400 ${fieldRow}`}>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Upload className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 truncate">{busy ? 'Uploading…' : 'Upload PDF or image'}</span>
        <input
          id={id}
          type="file"
          className="sr-only"
          accept={ACCEPT}
          disabled={busy}
          onChange={async e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setBusy(true)
            await onFile(f).finally(() => setBusy(false))
          }}
        />
      </label>
    </div>
  )
}

/** A licence's expiry: from today on. Also the console's Licences & certificates page. */
export function ExpiryField({ today, value, onChange }: { today: string; value: string; onChange: (ymd: string) => void }) {
  return (
    <div>
      <span className={fieldLabel}>Valid until</span>
      <DatePicker aria-label="Valid until" className="w-full" triggerClassName={fieldInput} placeholder="Pick a date" min={today} value={value} onChange={onChange} />
    </div>
  )
}

function YesNo({ ask, value, onChange }: { ask: string; value: boolean | undefined; onChange: (yes: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="text-sm text-foreground">{ask}</p>
      <ChoiceChips
        ariaLabel={ask}
        size="md"
        className="shrink-0"
        value={value === undefined ? null : value ? 'yes' : 'no'}
        onChange={v => onChange(v === 'yes')}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
    </div>
  )
}

function DocCard({ docId, value, onPatch }: { docId: string; value: ComplianceUpload | undefined; onPatch: (patch: Partial<ComplianceUpload> | null) => void }) {
  const doc = DOCS[docId]
  const [err, setErr] = useState<string | null>(null)
  if (!doc) return null
  const today = todayIst()
  const started = !!(value?.s3Key || value?.number || value?.expiresOn)
  const problem = started ? docProblem(doc, value, today) : null
  return (
    <div className="space-y-3 rounded-xl border border-border-default bg-surface p-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-foreground">{doc.name}</span>
          <span className="text-xs font-medium org-brown">Required</span>
        </div>
        <p className="mt-0.5 text-xs text-foreground-muted">
          {doc.authority} · {doc.who}
          {doc.link && (
            <>
              {' · '}
              <a href={doc.link} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Official site
              </a>
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FileField
          id={`doc-${docId}-file`}
          label="Document"
          fileName={value?.s3Key ? value.fileName || 'Uploaded' : null}
          onRemove={() => onPatch({ s3Key: '', fileName: '' })}
          onFile={async f => {
            setErr(null)
            try {
              const s3Key = await uploadKyc(f, docId)
              onPatch({ s3Key, fileName: f.name })
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
        />
        {doc.numberLabel && (
          <div>
            <label htmlFor={`doc-${docId}-number`} className={fieldLabel}>
              {doc.numberLabel}
            </label>
            <input
              id={`doc-${docId}-number`}
              className={fieldInput}
              value={value?.number ?? ''}
              maxLength={64}
              autoCapitalize="characters"
              placeholder={doc.numberHint}
              onChange={e => onPatch({ number: e.target.value.toUpperCase() })}
              onBlur={e => onPatch({ number: cleanDocNumber(e.target.value) })}
            />
          </div>
        )}
        {doc.expires && <ExpiryField today={today} value={value?.expiresOn ?? ''} onChange={expiresOn => onPatch({ expiresOn })} />}
      </div>
      {(err || problem) && <p className={errCls}>{err ?? problem}</p>}
    </div>
  )
}

export default function CompliancePanel({
  categories,
  value,
  onChange,
}: {
  categories: string[]
  value: ComplianceState
  onChange: Dispatch<SetStateAction<ComplianceState>>
}) {
  const plan = compliancePlan(categories)
  const answers = value.answers ?? {}
  const answer = (id: string, yes: boolean) => onChange(v => ({ ...v, answers: { ...v.answers, [id]: yes } }))
  const patchDoc = (doc: string) => (patch: Partial<ComplianceUpload> | null) =>
    onChange(v => {
      const docs = { ...v.docs }
      if (patch) docs[doc] = { ...(docs[doc] ?? { s3Key: '' }), ...patch }
      else delete docs[doc]
      return { ...v, docs }
    })
  // Each document is asked for once: where it is required, or under the first yes that needs it.
  const shown = new Set<string>()
  const take = (ids: string[]) => ids.filter(d => DOCS[d] && !shown.has(d) && !!shown.add(d))
  const card = (d: string) => <DocCard key={d} docId={d} value={value.docs?.[d]} onPatch={patchDoc(d)} />

  const quiet = plan.sections.filter(s => !s.required.length && !s.questions.length && !s.notes.length).map(s => s.category)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Licences & certificates</h3>
        <p className="mt-1 text-xs text-foreground-muted">
          What Indian law asks of stores selling what you picked. Upload each one (PDF, JPG, PNG or WebP, up to 5 MB) with its number; we review them with your
          application. See section 6 of the{' '}
          <a href="/legal/merchant-agreement#6-restricted-categories-licences-certificates-required" target="_blank" rel="noopener noreferrer" className="underline">
            Merchant Agreement
          </a>
          .
        </p>
      </div>

      <section className="space-y-3 rounded-xl bg-surface-secondary/50 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">Every store</h4>
        {plan.general.map(q => (
          <div key={q.id} className="space-y-3">
            <YesNo ask={q.ask} value={answers[q.id]} onChange={yes => answer(q.id, yes)} />
            {answers[q.id] === true && take(q.docs).map(card)}
          </div>
        ))}
        <YesNo ask={RESTRICTED_ASK} value={answers[RESTRICTED_QUESTION]} onChange={yes => answer(RESTRICTED_QUESTION, yes)} />
        {answers[RESTRICTED_QUESTION] === true && (
          <div role="alert" className={`${noteCls} bg-[#f2d4cd] text-[#8a2e1f]`}>
            {RESTRICTED_MESSAGE}
          </div>
        )}
      </section>

      {plan.sections
        .filter(s => !quiet.includes(s.category))
        .map(s => (
          <section key={s.category} className="space-y-3 border-t border-border-default pt-4">
            <h4 className="text-sm font-semibold text-foreground">{s.category}</h4>
            {take(s.required).map(card)}
            {s.questions.map(q => (
              <div key={q.id} className="space-y-3">
                <YesNo ask={q.ask} value={answers[q.id]} onChange={yes => answer(q.id, yes)} />
                {answers[q.id] === true && take(q.docs).map(card)}
              </div>
            ))}
            {s.notes.map(n => (
              <p key={n} className="text-xs text-foreground-muted">
                {n}
              </p>
            ))}
          </section>
        ))}
      {quiet.length > 0 && <p className="text-xs text-foreground-muted">Nothing more is needed for {quiet.join(', ')}.</p>}
    </div>
  )
}
