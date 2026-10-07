'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

interface VaultFile {
  id: string
  kind: string
  status: string
  downloadable: boolean
  display_name: string
  mime_type: string
  size_bytes: string
  created_at: string
}

interface Props {
  productId: string
}

const ACCEPT =
  '.mp4,.webm,.mov,.mp3,.m4a,.wav,.pdf,.png,.jpg,.jpeg,.webp,.zip,.epub'

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export default function DigitalFilesPanel({ productId }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('vault')
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const base = `/api/admin/products/${productId}/files`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(base)
      const data = await res.json()
      if (res.ok) setFiles(data.files || [])
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setBusy(true)
    try {
      const resv = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reserve',
          display_name: file.name,
          mime_type: file.type,
          declared_bytes: file.size,
        }),
      })
      const rd = await resv.json()
      if (!resv.ok) throw new Error(rd.error || 'Reservation failed')

      const put = await fetch(rd.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': rd.mime_type },
        body: file,
      })
      if (!put.ok) throw new Error('Upload failed')

      const comp = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', session_id: rd.session_id }),
      })
      const cd = await comp.json()
      if (!comp.ok) throw new Error(cd.error || 'Finalise failed')
      showToast('File uploaded', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleDownloadable(f: VaultFile) {
    const next = !f.downloadable
    setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, downloadable: next } : x)))
    const res = await fetch(base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: f.id, downloadable: next }),
    })
    if (!res.ok) {
      setFiles(prev => prev.map(x => (x.id === f.id ? { ...x, downloadable: !next } : x)))
      showToast('Could not update', 'error')
    }
  }

  async function remove(f: VaultFile) {
    if (
      !(await confirm({
        title: 'Delete file',
        message: `Delete "${f.display_name}"?`,
        confirmLabel: 'Delete',
        variant: 'danger',
      }))
    )
      return
    const res = await fetch(`${base}?file_id=${encodeURIComponent(f.id)}`, { method: 'DELETE' })
    if (res.ok) {
      setFiles(prev => prev.filter(x => x.id !== f.id))
      showToast('File deleted', 'success')
    } else {
      showToast('Could not delete', 'error')
    }
  }

  return (
    <div className="sm:col-span-2 pt-3 border-t border-border-default">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-foreground">Digital Files</h4>
        {canWrite && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={onPick}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded bg-accent-600 text-white disabled:opacity-50"
            >
              {busy ? 'Uploading…' : 'Upload file'}
            </button>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-foreground-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          No files yet. Buyers open these in the vault; downloads also require the store-wide download switch.
        </p>
      ) : (
        <ul className="divide-y divide-border-default border border-border-default rounded">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="shrink-0 uppercase text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted">
                {f.kind}
              </span>
              <span className="flex-1 truncate text-foreground" title={f.display_name}>
                {f.display_name}
              </span>
              <span className="shrink-0 text-xs text-foreground-muted">{fmtBytes(Number(f.size_bytes))}</span>
              <label className="shrink-0 flex items-center gap-1 text-xs text-foreground-muted">
                <input
                  type="checkbox"
                  checked={f.downloadable}
                  disabled={!canWrite}
                  onChange={() => toggleDownloadable(f)}
                />
                Downloadable
              </label>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(f)}
                  className="shrink-0 text-xs text-danger-600 hover:underline"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
