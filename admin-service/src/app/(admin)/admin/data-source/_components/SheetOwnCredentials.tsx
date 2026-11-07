'use client'

import { useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { KeyRound } from 'lucide-react'
import { btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'

type Mode = 'oauth' | 'service_account'
const EMPTY = { clientId: '', clientSecret: '', refreshToken: '', serviceAccountJson: '' }

/** "Use your own Google credentials" for the sheet sync: an own OAuth client + refresh token, or a
 * service account the sheet is shared with. Secrets are write-only. */
export default function SheetOwnCredentials({
  sheet,
  onDone,
}: {
  sheet?: string
  onDone: (ok: boolean, text: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('oauth')
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canWrite = useCanWrite('products')
  const ready = mode === 'oauth' ? !!(f.clientId.trim() && f.clientSecret.trim() && f.refreshToken.trim()) : !!f.serviceAccountJson.trim()

  async function save() {
    setBusy(true)
    setError(null)
    const body =
      mode === 'oauth'
        ? { mode, clientId: f.clientId, clientSecret: f.clientSecret, refreshToken: f.refreshToken, sheet }
        : { mode, serviceAccountJson: f.serviceAccountJson, sheet }
    const res = await fetch('/api/admin/data-source/google/credentials', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : { error: 'The connection dropped. Try again.' }
    setBusy(false)
    if (!res?.ok) return setError(data.error || 'Could not save the credentials')
    setF(EMPTY)
    setOpen(false)
    await onDone(true, 'Google credentials saved. Sync now reads the sheet with them.')
  }

  if (!canWrite) return null
  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        <KeyRound className="w-4 h-4" /> Use your own credentials
      </button>
    )
  }

  const field = (k: keyof typeof EMPTY, label: string, secret = false) => (
    <label className="block text-xs space-y-1">
      <span className="text-foreground-muted">{label}</span>
      <input
        className={inputCls}
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        value={f[k]}
        onChange={e => setF(p => ({ ...p, [k]: e.target.value }))}
      />
    </label>
  )

  return (
    <div className="space-y-3 rounded-lg border border-border-default p-3">
      <div className="flex flex-wrap gap-2">
        {(['oauth', 'service_account'] as const).map(m => (
          <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? btnPrimary : btnGhost} onClick={() => setMode(m)}>
            {m === 'oauth' ? 'Own OAuth client' : 'Service account'}
          </button>
        ))}
      </div>
      {mode === 'oauth' ? (
        <>
          <p className="text-xs text-foreground-muted">
            Create an OAuth client (Web application) in your Google Cloud project with https://developers.google.com/oauthplayground
            as a redirect URI, then get a refresh token for it in the Google OAuth Playground with the scopes
            spreadsheets.readonly and drive.file. A consent screen left in Testing gives tokens that expire
            after 7 days.
          </p>
          {field('clientId', 'OAuth client ID')}
          {field('clientSecret', 'OAuth client secret', true)}
          {field('refreshToken', 'Refresh token', true)}
        </>
      ) : (
        <>
          <p className="text-xs text-foreground-muted">
            Paste a service account key, then share your sheet with the service account&apos;s email (Viewer). A service
            account cannot create the template sheet; make it yourself and paste its link.
          </p>
          <label className="block text-xs space-y-1">
            <span className="text-foreground-muted">Service account key (JSON)</span>
            <textarea
              rows={5}
              value={f.serviceAccountJson}
              onChange={e => setF(p => ({ ...p, serviceAccountJson: e.target.value }))}
              placeholder='{ "type": "service_account", ... }'
              className="w-full text-xs font-mono rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-foreground"
            />
          </label>
        </>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 break-words">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={save}>
          {busy ? 'Checking...' : 'Verify and save'}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
