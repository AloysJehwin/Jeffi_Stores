'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import type { OutreachList } from '@controller/lib/outreach/types'
import type { ImportSummary } from '@controller/lib/outreach/import'
import { API } from './shared'

type Result = { name: string; summary: ImportSummary }

function Summary({ r }: { r: Result }) {
  const s = r.summary
  return (
    <Card title={`Last import: ${r.name}`} hint={`${s.total} rows read: ${s.inserted} new, ${s.updated} updated, ${s.rejected} rejected`}>
      {!s.rejections.length ? (
        <p className="text-sm text-foreground-muted">No rows were rejected.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                <th className="py-1.5 pr-3">Row</th>
                <th className="py-1.5 pr-3">Phone</th>
                <th className="py-1.5">Reason</th>
              </tr>
            </thead>
            <tbody>
              {s.rejections.map((x, i) => (
                <tr key={`${x.row}-${i}`} className="border-t border-border-default/60">
                  <td className="py-1.5 pr-3 tabular-nums">{x.row}</td>
                  <td className="py-1.5 pr-3">{x.phone || '-'}</td>
                  <td className="py-1.5">{x.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function OutreachListsClient() {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [lists, setLists] = useState<OutreachList[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [upName, setUpName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState({ name: '', sheetUrl: '', sheetTitle: '' })

  const load = useCallback(async () => {
    const { ok, data } = await api<{ lists: OutreachList[] }>(`${API}/lists`)
    if (!ok) return setError(data.error || 'Could not load the lists')
    setError(null)
    setLists(data.lists)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return toast.error('Choose a .csv or .xlsx file')
    const name = upName.trim() || file.name
    const fd = new FormData()
    fd.set('file', file)
    fd.set('name', name)
    setBusy('upload')
    const { ok, data } = await api<{ list: OutreachList; summary: ImportSummary }>(`${API}/lists`, { method: 'POST', body: fd })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Upload failed')
    setResult({ name, summary: data.summary })
    setUpName('')
    if (fileRef.current) fileRef.current.value = ''
    toast.success(`Imported ${data.summary.inserted + data.summary.updated} contacts`)
    load()
  }

  async function connect() {
    setBusy('sheet')
    const json = { name: sheet.name.trim(), sheetUrl: sheet.sheetUrl.trim(), ...(sheet.sheetTitle.trim() ? { sheetTitle: sheet.sheetTitle.trim() } : {}) }
    const { ok, data } = await api<{ list: OutreachList; summary: ImportSummary }>(`${API}/lists`, { method: 'POST', json })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Could not connect the sheet')
    setResult({ name: json.name, summary: data.summary })
    setSheet({ name: '', sheetUrl: '', sheetTitle: '' })
    toast.success('Sheet connected and synced')
    load()
  }

  async function sync(l: OutreachList) {
    setBusy(l.id)
    const { ok, data } = await api<{ list: OutreachList; summary: ImportSummary }>(`${API}/lists/${l.id}/sync`, { method: 'POST' })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Sync failed')
    setResult({ name: l.name, summary: data.summary })
    toast.success('Synced')
    load()
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Upload a file" hint="CSV or XLSX, up to 15 MB. Needs a phone column and a business name.">
          <div className="space-y-3">
            <input aria-label="List name" className={inputCls} placeholder="List name" value={upName} disabled={!canWrite} onChange={e => setUpName(e.target.value)} />
            <input ref={fileRef} aria-label="File" type="file" accept=".csv,.xlsx,.xls" disabled={!canWrite} className="block w-full text-sm text-foreground-muted file:mr-3 file:rounded-lg file:border file:border-border-default file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground" />
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} disabled={!canWrite || busy === 'upload'} onClick={upload}>
                {busy === 'upload' ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </Card>
        <Card title="Connect a Google Sheet" hint="Uses the platform's Google Sheets connection. Share the sheet with it first. Re-sync any time.">
          <div className="space-y-3">
            <input aria-label="Sheet list name" className={inputCls} placeholder="List name" value={sheet.name} disabled={!canWrite} onChange={e => setSheet({ ...sheet, name: e.target.value })} />
            <input aria-label="Sheet link" className={inputCls} placeholder="https://docs.google.com/spreadsheets/d/…" value={sheet.sheetUrl} disabled={!canWrite} onChange={e => setSheet({ ...sheet, sheetUrl: e.target.value })} />
            <input aria-label="Tab name" className={inputCls} placeholder="Tab name (optional, first tab by default)" value={sheet.sheetTitle} disabled={!canWrite} onChange={e => setSheet({ ...sheet, sheetTitle: e.target.value })} />
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} disabled={!canWrite || busy === 'sheet' || !sheet.name.trim() || !sheet.sheetUrl.trim()} onClick={connect}>
                {busy === 'sheet' ? 'Syncing…' : 'Connect and sync'}
              </button>
            </div>
          </div>
        </Card>
      </div>

      {result && <Summary r={result} />}

      <Card title="Import history" flush>
        {error && <p className="px-5 pb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!lists && !error && <div className="mx-5 mb-5 h-24 rounded-lg bg-surface-secondary animate-pulse" />}
        {lists && !lists.length && <p className="px-5 pb-5 text-sm text-foreground-muted">No lists yet.</p>}
        {lists && !!lists.length && (
          <ul className="divide-y divide-border-default/60">
            {lists.map(l => (
              <li key={l.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{l.name}</div>
                  <div className="text-xs text-foreground-muted">
                    {l.row_count.toLocaleString('en-IN')} rows · {l.source === 'google_sheet' ? `Sheet, synced ${when(l.last_synced_at)}` : `Upload, ${when(l.created_at)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={l.source === 'google_sheet' ? 'blue' : 'muted'}>{l.source === 'google_sheet' ? 'Google Sheet' : 'File'}</Badge>
                  {l.source === 'google_sheet' && (
                    <button type="button" className={btnGhost} disabled={!canWrite || busy === l.id} onClick={() => sync(l)}>
                      {busy === l.id ? 'Syncing…' : 'Sync now'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
