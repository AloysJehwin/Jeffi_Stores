'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { ChoiceChips } from '../../_ui'
import { Badge, fieldInput, fieldLabel, ghostBtn, noteCls, primaryBtn, secondaryBtn } from '../../onboard/ui'
import { ExpiryField, FileField, uploadKyc } from '../../onboard/CompliancePanel'
import { Card } from '../_components/Card'
import {
  DOCS,
  EXPIRY_REMINDER_DAYS,
  GENERAL,
  SELLING_CATEGORIES,
  categoryDocs,
  categoryNotes,
  cleanDocNumber,
  daysUntil,
  docProblem,
  docStanding,
  type ComplianceUpload,
  type DocStatus,
} from '@controller/lib/catalog/compliance'

// The console's Licences & certificates: the store's documents on file with their review, a renewed or corrected copy
// sent for one (uploaded the onboarding way, checked the same), and the documents a category it starts selling asks for.

export interface LicenceDoc {
  id: string
  docType: string
  category: string
  number: string | null
  /** YYYY-MM-DD */
  expiresOn: string | null
  status: DocStatus
  note: string | null
  reviewedAt: string | null
  sentAt: string
}

type Tone = 'sage' | 'peach' | 'red' | 'muted'
const STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  pending: { label: 'In review', tone: 'peach' },
  approved: { label: 'Approved', tone: 'sage' },
  rejected: { label: 'Not accepted', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
}
const SOON = EXPIRY_REMINDER_DAYS[0]
const errCls = 'text-xs text-[#8a2e1f]'
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayOf = (ts: string) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const nameOf = (type: string) => DOCS[type]?.name ?? type

type Save = (docType: string, category: string, u: ComplianceUpload) => Promise<boolean>

/** Where a document stands, with the days left when it lapses within the reminder window. */
function standing(d: LicenceDoc, today: string) {
  const status = docStanding({ status: d.status, expires_on: d.expiresOn }, today)
  const left = d.expiresOn ? daysUntil(d.expiresOn, today) : null
  const soon = left !== null && left >= 0 && left <= SOON && (status === 'approved' || status === 'pending')
  return { status, left, soon, rank: status === 'rejected' ? 0 : status === 'expired' ? 1 : soon ? 2 : status === 'pending' ? 3 : 4 }
}

function DocForm({ docType, today, number, onSave, onCancel }: { docType: string; today: string; number?: string | null; onSave: (u: ComplianceUpload) => Promise<boolean>; onCancel: () => void }) {
  const doc = DOCS[docType]
  // A renewal usually keeps its number.
  const [u, setU] = useState<ComplianceUpload>({ s3Key: '', number: number ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!doc) return null
  const problem = docProblem(doc, u, today)
  const id = `lic-${docType}`
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border-default bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FileField
          id={`${id}-file`}
          label="Document"
          fileName={u.s3Key ? u.fileName || 'Uploaded' : null}
          onRemove={() => setU(v => ({ ...v, s3Key: '', fileName: '' }))}
          onFile={async f => {
            setErr(null)
            try {
              const s3Key = await uploadKyc(f, docType)
              setU(v => ({ ...v, s3Key, fileName: f.name }))
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
        />
        {doc.numberLabel && (
          <div>
            <label htmlFor={`${id}-number`} className={fieldLabel}>
              {doc.numberLabel}
            </label>
            <input
              id={`${id}-number`}
              className={fieldInput}
              value={u.number ?? ''}
              maxLength={64}
              autoCapitalize="characters"
              placeholder={doc.numberHint}
              onChange={e => setU(v => ({ ...v, number: e.target.value.toUpperCase() }))}
              onBlur={e => setU(v => ({ ...v, number: cleanDocNumber(e.target.value) }))}
            />
          </div>
        )}
        {doc.expires && <ExpiryField today={today} value={u.expiresOn ?? ''} onChange={expiresOn => setU(v => ({ ...v, expiresOn }))} />}
      </div>
      {(err || (u.s3Key && problem)) && <p className={errCls}>{err ?? problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={!!problem || busy}
          onClick={async () => {
            setBusy(true)
            await onSave(u)
            setBusy(false)
          }}
        >
          {busy ? 'Sending…' : 'Send for review'}
        </button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function OnFileRow({ d, today, open, onOpen, onClose, onSave }: { d: LicenceDoc; today: string; open: boolean; onOpen: () => void; onClose: () => void; onSave: Save }) {
  const doc = DOCS[d.docType]
  const { status, left, soon } = standing(d, today)
  const st = STATUS[status]
  const urgent = status === 'rejected' || status === 'expired' || soon
  const action = status === 'rejected' ? 'Upload a new copy' : status === 'expired' || soon ? 'Upload the renewed one' : 'Replace'
  const decided = d.reviewedAt && (status === 'approved' || status === 'rejected') ? ` · ${status === 'rejected' ? 'not accepted' : 'approved'} ${dayOf(d.reviewedAt)}` : ''
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground break-words">{nameOf(d.docType)}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {soon && <Badge tone="peach">{left === 0 ? 'Expires today' : `Expires in ${left} day${left === 1 ? '' : 's'}`}</Badge>}
          </div>
          <p className="mt-1 text-xs text-foreground-muted break-words">
            {d.category}
            {d.number && (
              <>
                {' · '}
                {doc?.numberLabel ?? 'Number'} <span className="font-mono text-foreground-secondary">{d.number}</span>
              </>
            )}
            {d.expiresOn && (
              <>
                {' · '}
                {status === 'expired' ? 'Expired' : 'Valid until'} {dateOf(d.expiresOn)}
              </>
            )}
          </p>
          {d.sentAt && (
            <p className="mt-0.5 text-xs text-foreground-muted">
              Sent {dayOf(d.sentAt)}
              {decided}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a href={`/api/ecom/compliance/${d.id}`} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
            View <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {!open && (
            <button type="button" onClick={onOpen} className={urgent ? primaryBtn : secondaryBtn}>
              {action}
            </button>
          )}
        </div>
      </div>
      {status === 'rejected' && (
        <div className={`${noteCls} mt-3 bg-[#f2d4cd] text-[#8a2e1f]`}>
          <span className="font-semibold">Why it was not accepted: </span>
          {d.note || 'Upload a clear, complete and current copy.'}
        </div>
      )}
      {status !== 'rejected' && d.note && (
        <div className={`${noteCls} mt-3 bg-surface-secondary text-foreground-secondary`}>
          <span className="font-semibold">Note from our review: </span>
          {d.note}
        </div>
      )}
      {status === 'expired' && !open && (
        <p className="mt-2 text-xs text-[#8a2e1f]">It shows as expired on your store&apos;s record until you send the renewed one.</p>
      )}
      {open && <DocForm docType={d.docType} today={today} number={d.number} onSave={u => onSave(d.docType, d.category, u)} onCancel={onClose} />}
    </li>
  )
}

function AddLicence({ selling, onFile, today, onSave }: { selling: string[]; onFile: Map<string, LicenceDoc>; today: string; onSave: Save }) {
  const [category, setCategory] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const options = [...SELLING_CATEGORIES.filter(c => categoryDocs(c).length > 0), GENERAL]
  const items = category ? categoryDocs(category) : []
  return (
    <Card title="Selling something new?">
      <p className="text-sm text-foreground-secondary">
        Pick what you are starting to sell to see the licences it needs, then upload the ones that apply. Each one goes to our review.
        {selling.length > 0 && ` You applied to sell ${selling.join(', ')}.`}
      </p>
      <ChoiceChips
        ariaLabel="What you are starting to sell"
        className="mt-4"
        value={category}
        onChange={c => {
          setCategory(c)
          setOpen(null)
        }}
        options={options.map(c => ({ value: c, label: c === GENERAL ? 'Every store' : c }))}
      />
      {category && (
        <ul className="mt-5 divide-y divide-border-default/60">
          {items.map(item => {
            const doc = DOCS[item.doc]
            const have = onFile.get(item.doc)
            const haveSt = have ? STATUS[docStanding({ status: have.status, expires_on: have.expiresOn }, today)] : null
            return (
              <li key={item.doc} className="py-3 first:pt-0">
                {item.ask && <p className="mb-1 text-xs font-medium text-foreground-secondary">{item.ask} Then you need:</p>}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-foreground">{doc.name}</span>
                      {item.required && <span className="text-xs font-medium org-brown">Required</span>}
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
                  {haveSt ? (
                    <Badge tone={haveSt.tone}>On file · {haveSt.label}</Badge>
                  ) : (
                    open !== item.doc && (
                      <button type="button" className={secondaryBtn} onClick={() => setOpen(item.doc)}>
                        Upload
                      </button>
                    )
                  )}
                </div>
                {!have && open === item.doc && (
                  <DocForm
                    docType={item.doc}
                    today={today}
                    onCancel={() => setOpen(null)}
                    onSave={async u => {
                      const ok = await onSave(item.doc, category, u)
                      if (ok) setOpen(null)
                      return ok
                    }}
                  />
                )}
              </li>
            )
          })}
          {items.length === 0 && <li className="py-3 text-sm text-foreground-secondary">Nothing more is needed for {category}.</li>}
        </ul>
      )}
      {category &&
        categoryNotes(category).map(n => (
          <p key={n} className="mt-3 text-xs text-foreground-muted">
            {n}
          </p>
        ))}
    </Card>
  )
}

export default function LicencesClient({ tenantId, today, selling, documents }: { tenantId: string; today: string; selling: string[]; documents: LicenceDoc[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState<string | null>(null)

  const save: Save = async (docType, category, u) => {
    const res = await fetch('/api/ecom/compliance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, docType, category, number: u.number || null, expiresOn: u.expiresOn || null, s3Key: u.s3Key, fileName: u.fileName || null }),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) {
      showToast(data?.error || 'Could not send the document. Try again.', 'error')
      return false
    }
    showToast(`${nameOf(docType)} sent for review. We email you if anything is wrong.`, 'success')
    setOpen(null)
    router.refresh()
    return true
  }

  const sorted = [...documents].sort((a, b) => standing(a, today).rank - standing(b, today).rank || nameOf(a.docType).localeCompare(nameOf(b.docType)))
  return (
    <div className="space-y-6">
      <Card title="On file">
        {sorted.length === 0 ? (
          <p className="text-sm text-foreground-secondary">No licences on file: what you sell did not need any. When you start selling something that does, add it below.</p>
        ) : (
          <ul className="divide-y divide-border-default/60">
            {sorted.map(d => (
              <OnFileRow key={d.id} d={d} today={today} open={open === d.id} onOpen={() => setOpen(d.id)} onClose={() => setOpen(null)} onSave={save} />
            ))}
          </ul>
        )}
      </Card>
      <AddLicence selling={selling} onFile={new Map(documents.map(d => [d.docType, d]))} today={today} onSave={save} />
    </div>
  )
}
