'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'

export default function ExtensionTokenCard() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  // When the clipboard API is unavailable (non-secure origin) we still show the token
  // so it can be copied manually instead of silently losing it.
  const [token, setToken] = useState('')

  async function handleCopy() {
    setError('')
    setToken('')
    // 1) Mint the token — surface the real failure (auth/expired session) distinctly.
    let minted: string
    try {
      const res = await fetch('/api/admin/cli/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'extension', scopes: ['products:write'], ttl: '24h', name: 'Gallery Uploader extension' }),
      })
      if (res.status === 401) throw new Error('Your admin session expired — reload and sign in, then try again.')
      if (res.status === 400 || res.status === 403)
        throw new Error('Your account lacks the products:write permission needed for the extension token.')
      if (!res.ok) throw new Error(`Failed to generate token (HTTP ${res.status}).`)
      const data = await res.json()
      if (!data?.token) throw new Error('No token returned by the server.')
      minted = data.token
    } catch (e: any) {
      setError(e?.message || 'Could not generate token. Try again.')
      return
    }
    // 2) Copy — if the clipboard API is unavailable (e.g. non-secure origin), fall back
    // to displaying the token for manual copy rather than reporting a failure.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(minted)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      } else {
        setToken(minted)
      }
    } catch {
      setToken(minted) // clipboard blocked — show it so the user can select + copy
    }
  }

  return (
    <div className="bg-surface-elevated rounded-xl shadow-sm border border-border-default">
      <div className="px-5 py-4 border-b border-border-default">
        <h2 className="text-sm font-semibold text-foreground">Chrome Extension Token</h2>
        <p className="text-xs text-foreground-muted mt-0.5">
          Generate a scoped upload token for the Jeffi Gallery Uploader extension.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3 p-3 bg-surface-secondary rounded-lg border border-border-default font-mono text-sm text-foreground-secondary">
          {token ? (
            <input
              readOnly
              value={token}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-transparent outline-none"
            />
          ) : (
            <span className="flex-1 min-w-0 truncate">jfc_••••••••••••••••••••••••••••••</span>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {token && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Auto-copy unavailable on this origin — select the token above and copy it manually.
          </p>
        )}
        <RequireWrite scope="settings:write">
          <button
            onClick={handleCopy}
            className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-accent-500 hover:bg-accent-600 text-white'}`}
          >
            {copied ? 'Copied!' : 'Copy Token'}
          </button>
        </RequireWrite>
        <p className="text-xs text-foreground-muted">
          Scoped to product image uploads only, valid 24 hours. Revoke it any time under Settings → CLI &amp; tokens.
          Your login session is never shared.
        </p>
      </div>
    </div>
  )
}
