'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'

// An image-URL field with an Upload button: paste a link or upload a file (→ CDN URL in the field).

// Raw bytes rather than multipart: the server checks it received every byte (lib/shared/form-file).
export async function uploadImage(file: File, endpoint = '/api/admin/uploads/image'): Promise<string> {
  const r = await fetch(endpoint, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.url) throw new Error(d.error || 'Upload failed')
  return d.url as string
}

export default function ImageUrlInput({ value, onChange, placeholder, className = '', endpoint, name, preview = true }: {
  value: string
  onChange: (url: string) => void
  placeholder?: string
  className?: string
  endpoint?: string
  /** For uncontrolled server-action forms: also submit the value under this name. */
  name?: string
  preview?: boolean
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true); setErr(null)
    try { onChange(await uploadImage(f, endpoint)) } catch (e: any) { setErr(e.message) } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder ?? 'https://… or upload'} className={`${className} flex-1 min-w-0`} />
        {name && <input type="hidden" name={name} value={value} />}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={e => pick(e.target.files?.[0])} />
        <button type="button" onClick={() => file.current?.click()} disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-lg border border-border-default px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {busy ? 'Uploading…' : 'Upload'}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && value && /^(https?:)?\/\/|^\//.test(value) && <img src={value} alt="" className="h-9 w-9 shrink-0 rounded object-cover border border-border-default" />}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}
