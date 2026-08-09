'use client'

import { useState } from 'react'

export default function ExtensionTokenCard() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function handleCopy() {
    setError('')
    try {
      // Issue a SEPARATE, short-lived, scope-limited token for the extension — never
      // the admin session JWT (that stays in the HttpOnly cookie and is never exposed).
      const res = await fetch('/api/admin/token/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: ['products:write'], ttl: 86400 }),
      })
      if (!res.ok) throw new Error('Failed to generate token')
      const { token } = await res.json()
      if (!token) throw new Error('No token returned')
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setError('Could not copy token. Try again.')
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="px-6 py-4 border-b border-border-default">
        <h2 className="text-lg font-semibold text-foreground">Chrome Extension Token</h2>
        <p className="text-sm text-foreground-muted mt-1">Generate a scoped upload token for the Jeffi Gallery Uploader extension.</p>
      </div>
      <div className="p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-3 p-3 bg-surface-secondary rounded-lg border border-border-default font-mono text-sm text-foreground-secondary">
          <span className="flex-1 truncate">eyJ••••••••••••••••••••••••••••••</span>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          onClick={handleCopy}
          className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-accent-500 hover:bg-accent-600 text-white'}`}
        >
          {copied ? 'Copied!' : 'Copy Token'}
        </button>
        <p className="text-xs text-foreground-muted">Scoped to product image uploads only, valid 24 hours. Generate a fresh token when it expires. Your login session is never shared.</p>
      </div>
    </div>
  )
}
