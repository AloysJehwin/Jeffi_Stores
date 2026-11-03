'use client'

import { useEffect, useState } from 'react'

export type DocKey = 'invoice' | 'packing_slip' | 'label'
export type LabelSize = '4x6' | 'a4'
export interface DocumentSet {
  docs: DocKey[]
  label: LabelSize
}

export interface DocOrder {
  id: string
  order_number: string
  awb_number?: string | null
  invoice_number?: string | null
  digital_only?: boolean
}

/** Page order within an order's set. */
export const DOC_ORDER: DocKey[] = ['invoice', 'packing_slip', 'label']

export const DOC_META: Record<DocKey, { label: string; icon: string; unavailable: string }> = {
  invoice: {
    label: 'Invoice',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    unavailable: 'Not invoiced yet',
  },
  packing_slip: {
    label: 'Packing slip',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    unavailable: 'Digital items only, nothing to pack',
  },
  label: {
    label: 'Shipping label',
    icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
    unavailable: 'No AWB yet',
  },
}

export const DOWNLOAD_ICON = 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'

export function docAvailable(order: DocOrder, doc: DocKey): boolean {
  if (doc === 'invoice') return !!order.invoice_number
  if (doc === 'label') return !!order.awb_number
  return !order.digital_only
}

const STORAGE_KEY = 'admin.packingSlips.documentSet'
const DEFAULT_SET: DocumentSet = { docs: ['packing_slip'], label: '4x6' }

/** The admin's chosen documents, remembered on this device; invoice and label need `orders:read`. */
export function useDocumentSet(canOrders: boolean): [DocumentSet, (next: DocumentSet) => void] {
  const [set, setSet] = useState<DocumentSet>(DEFAULT_SET)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && Array.isArray(saved.docs))
        setSet({
          docs: DOC_ORDER.filter(d => saved.docs.includes(d)),
          label: saved.label === 'a4' ? 'a4' : '4x6',
        })
    } catch {}
  }, [])
  const update = (next: DocumentSet) => {
    setSet(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }
  const docs = set.docs.filter(d => canOrders || d === 'packing_slip')
  return [{ ...set, docs: docs.length ? docs : ['packing_slip'] }, update]
}

export function Icon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

export function DocumentSetPicker({
  value,
  onChange,
  canOrders,
}: {
  value: DocumentSet
  onChange: (next: DocumentSet) => void
  canOrders: boolean
}) {
  const choices = DOC_ORDER.filter(d => canOrders || d === 'packing_slip')
  const toggle = (doc: DocKey) => {
    const on = value.docs.includes(doc)
    if (on && value.docs.length === 1) return
    onChange({ ...value, docs: DOC_ORDER.filter(d => (d === doc ? !on : value.docs.includes(d))) })
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Documents to download">
      <span className="text-xs font-medium text-foreground-muted">Documents</span>
      {choices.map(doc => {
        const on = value.docs.includes(doc)
        return (
          <button
            key={doc}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(doc)}
            title={on && value.docs.length === 1 ? 'Keep at least one document' : undefined}
            className={`inline-flex items-center gap-1.5 h-control-sm px-3 rounded-lg border text-sm font-medium transition-colors ${
              on
                ? 'border-secondary-500 bg-secondary-500/10 text-foreground'
                : 'border-border-default text-foreground-muted hover:text-foreground hover:bg-surface-secondary'
            }`}
          >
            <Icon d={on ? 'M5 13l4 4L19 7' : DOC_META[doc].icon} className="w-3.5 h-3.5" />
            {DOC_META[doc].label}
          </button>
        )
      })}
      {value.docs.includes('label') && (
        <div className="inline-flex h-control-sm rounded-lg border border-border-default p-0.5" role="radiogroup" aria-label="Label size">
          {(['4x6', 'a4'] as const).map(size => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={value.label === size}
              onClick={() => onChange({ ...value, label: size })}
              title={size === '4x6' ? '4×6 in thermal label' : "Delhivery's A4 label"}
              className={`px-2.5 rounded-md text-xs font-medium transition-colors ${
                value.label === size ? 'bg-secondary-500 text-white' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {size === '4x6' ? '4×6' : 'A4'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function filenameFrom(res: Response, fallback: string) {
  return /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallback
}

/** "no invoice for #1043, #1051 · …" from the X-Documents-Skipped header, or '' when nothing was left out. */
function skippedText(res: Response): string {
  let skipped: Partial<Record<DocKey, string[]>> = {}
  try {
    skipped = JSON.parse(res.headers.get('x-documents-skipped') || '{}')
  } catch {}
  return DOC_ORDER.filter(d => skipped[d]?.length)
    .map(d => {
      const nums = skipped[d]!
      const shown = nums.slice(0, 3).map(n => `#${n}`).join(', ')
      return `no ${DOC_META[d].label.toLowerCase()} for ${shown}${nums.length > 3 ? ` +${nums.length - 3} more` : ''}`
    })
    .join(' · ')
}

/** Downloads the merged PDF. Returns what was left out ('' for nothing); throws the API's error. */
export async function downloadDocuments(
  target: { orderId: string } | { orderIds: string[] },
  set: DocumentSet
): Promise<string> {
  const res =
    'orderId' in target
      ? await fetch(`/api/admin/packing-slips/${target.orderId}/documents?docs=${set.docs.join(',')}&label=${set.label}`)
      : await fetch('/api/admin/packing-slips/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_ids: target.orderIds, docs: set.docs, label_size: set.label }),
        })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || 'Download failed')
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filenameFrom(res, 'documents.pdf')
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return skippedText(res)
}
