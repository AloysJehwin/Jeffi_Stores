'use client'

import { useState, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'

export default function LogoUploader({ initialUrl }: { initialUrl: string }) {
  const { showToast } = useToast()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/site-controls/logo', { method: 'POST', body: form, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        setUrl(data.url)
        showToast('Logo updated', 'success')
      } else {
        showToast(data.error || 'Upload failed', 'error')
      }
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function clearLogo() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/site-controls/logo', { method: 'DELETE', credentials: 'include' })
      if (res.ok) {
        setUrl('')
        showToast('Logo cleared — using default', 'success')
      } else {
        showToast('Failed to clear', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">Store Logo</label>
      <p className="text-xs text-foreground-muted mb-2">
        Shown in the site header, emails and PDFs. PNG with transparency recommended. Leave empty to use the built-in logo.
      </p>
      <div className="flex items-center gap-4">
        <div className="h-16 w-40 rounded-lg border border-border-default bg-surface-secondary flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url || '/images/logo.png'}
            alt="Store logo"
            className="max-h-14 max-w-[9rem] object-contain"
          />
        </div>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onFile} className="hidden" />
          <RequireWrite scope="settings:write">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors disabled:opacity-60"
            >
              {busy ? 'Uploading…' : url ? 'Replace logo' : 'Upload logo'}
            </button>
            {url && (
              <button
                type="button"
                onClick={clearLogo}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground-secondary rounded-lg transition-colors disabled:opacity-60"
              >
                Use default
              </button>
            )}
          </RequireWrite>
        </div>
      </div>
    </div>
  )
}
