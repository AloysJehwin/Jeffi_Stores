'use client'

import { useState } from 'react'

export default function ExtensionTokenCard() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function handleCopy() {
    setError('')
    try {
      const res = await fetch('/api/admin/token')
      if (!res.ok) throw new Error('Failed to retrieve token')
      const { token } = await res.json()
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
        <p className="text-sm text-foreground-muted mt-1">Copy your session token to configure the Jeffi Gallery Uploader extension.</p>
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
        <p className="text-xs text-foreground-muted">Token expires with your session. Copy a fresh token each time you log in.</p>
      </div>
    </div>
  )
}
