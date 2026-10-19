'use client'

import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useOverviewData } from '@/components/admin/overview/kit'
import { Banner, Section, btnGhost, when } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import JobDetail from './JobDetail'
import { JobBadge, type ImportJob } from './shared'

const MAX_BYTES = 15 * 1024 * 1024
const EXTENSIONS = ['.xlsx', '.xls', '.csv']

/** Client-side check before uploading; the server repeats it. */
export function fileProblem(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  if (!EXTENSIONS.includes(ext)) return 'Choose a .xlsx, .xls or .csv file.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB. Split it into smaller files.`
  return null
}

interface UploadResult {
  jobId: string
  totalRows: number
  products?: number
  invalid?: number
  duplicate?: boolean
  warnings?: string[]
}

export default function ImportTab({ refreshKey, onQueued }: { refreshKey: number; onQueued: () => void }) {
  const canWrite = useCanWrite('products')
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()
  const setProblem = (text: string | null) => text && toast.error(text)
  const [result, setResult] = useState<(UploadResult & { file: string }) | null>(null)
  const last = useOverviewData<{ jobs: ImportJob[] }>(result ? null : `/api/admin/data-source/jobs?source=upload&limit=1&k=${refreshKey}`)
  const lastJob = last.data?.jobs?.[0] ?? null

  const upload = async (file: File | undefined) => {
    if (!file || busy || !canWrite) return
    const bad = fileProblem(file)
    if (bad) {
      setProblem(bad)
      return
    }
    setProblem(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/data-source/import', { method: 'POST', credentials: 'include', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProblem(body.error || `Upload failed (${res.status}). Try again.`)
        return
      }
      setResult({ ...(body as UploadResult), file: file.name })
      if ((body as UploadResult).duplicate) toast.info('This file is already being imported; showing that import.')
      onQueued()
    } catch {
      setProblem('Upload failed: the connection dropped. Check your network and try again.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const disabled = !canWrite || busy

  return (
    <div className="grid gap-4 md:grid-cols-5">
      <div className="md:col-span-3 space-y-4">
        <Section title="Upload a file">
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label="Choose or drop a spreadsheet to import"
            onClick={() => !disabled && inputRef.current?.click()}
            onKeyDown={e => {
              if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={e => {
              e.preventDefault()
              if (!disabled) setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => {
              e.preventDefault()
              setDrag(false)
              if (!disabled) upload(e.dataTransfer.files?.[0])
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
              disabled ? 'opacity-60 cursor-not-allowed border-border-default' : drag ? 'border-accent-500 bg-accent-500/5 cursor-copy' : 'border-border-default hover:border-accent-500/60 cursor-pointer'
            }`}
          >
            <UploadCloud className="w-8 h-8 text-foreground-muted" />
            <p className="text-sm font-medium text-foreground">
              {busy ? 'Uploading and checking the file...' : canWrite ? 'Drop a spreadsheet here, or click to choose' : 'Read-only: you need products write access to import'}
            </p>
            <p className="text-xs text-foreground-muted">.xlsx, .xls or .csv, up to 15 MB and 5,000 rows</p>
            <input id="ds-upload" ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={disabled} onChange={e => upload(e.target.files?.[0])} />
          </div>
        </Section>

        {result ? (
          <Section title={`Import of ${result.file}`}>
            <div className="space-y-3">
              {!result.duplicate && (result.invalid ?? 0) > 0 && (
                <Banner ok={false}>
                  {result.invalid} of {result.totalRows} rows already have problems and will be skipped; the rest import normally.
                </Banner>
              )}
              {(result.warnings ?? []).length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5 space-y-0.5">
                  {result.warnings!.map(w => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <JobDetail id={result.jobId} />
            </div>
          </Section>
        ) : (
          lastJob && (
            <Section title="Last file import" action={<JobBadge status={lastJob.status} errors={lastJob.error_count} />}>
              <p className="text-xs text-foreground-muted mb-3">Started {when(lastJob.created_at)}</p>
              <JobDetail id={lastJob.id} compact />
            </Section>
          )
        )}
      </div>

      <div className="md:col-span-2 space-y-4">
        <Section title="Template">
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/data-source/template" className={btnGhost}>
              <FileSpreadsheet className="w-4 h-4" /> Excel template (.xlsx)
            </a>
            <a href="/api/admin/data-source/template?format=csv" className={btnGhost}>
              <Download className="w-4 h-4" /> CSV template
            </a>
          </div>
          <p className="mt-3 text-xs text-foreground-muted">
            The Excel template has a Products sheet, Variants and Sub-variants sheets, and attribute sheets, with dropdowns and a Field Guide. The CSV is one flat sheet where a
            row_type column says whether each row is a product, variant or sub-variant.
          </p>
        </Section>
        <Section title="How it works">
          <ul className="text-sm text-foreground-secondary list-disc pl-5 space-y-1.5">
            <li>
              <b>SKU is the key.</b> A SKU that already exists updates that product; a new SKU creates one, published and live.
            </li>
            <li>Blank cells keep the product&apos;s current value on update; on create they take the store default.</li>
            <li>Category, brand and supplier are matched by name and must already exist.</li>
            <li>
              Images: put URLs in <code>image_urls</code> separated by <code>|</code>. They are downloaded in the background; a bad link is a warning, not a failure.
            </li>
            <li>Rows with problems are skipped and listed with the reason; fix them and upload the file again. Rows that imported are not duplicated.</li>
            <li>Delete the template&apos;s example rows (TSHIRT-001); they are ignored if left in.</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
