'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { ADMIN_SCOPES } from '@/lib/scopes'

interface Created {
  id: string
  name: string
  p12_password: string
  download_url: string
}

// Build per-group structure: { group -> { read: scope, write: scope | null }[] }
function buildScopeGrid() {
  const groups: Record<string, { read: (typeof ADMIN_SCOPES)[0]; write: (typeof ADMIN_SCOPES)[0] | null }[]> = {}
  const byBase: Record<string, { read?: (typeof ADMIN_SCOPES)[0]; write?: (typeof ADMIN_SCOPES)[0] }> = {}

  for (const s of ADMIN_SCOPES) {
    const base = s.key.replace(/:read$|:write$/, '')
    byBase[base] = byBase[base] || {}
    if (s.key.endsWith(':read')) byBase[base].read = s
    else if (s.key.endsWith(':write')) byBase[base].write = s
  }

  for (const [, pair] of Object.entries(byBase)) {
    const ref = pair.read || pair.write!
    const group = ref.group || 'General'
    groups[group] = groups[group] || []
    groups[group].push({ read: pair.read!, write: pair.write || null })
  }

  return groups
}

const SCOPE_GRID = buildScopeGrid()
const ALL_KEYS = ADMIN_SCOPES.map(s => s.key)

export default function AddServiceAccountPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [copied, setCopied] = useState(false)

  function toggleScope(key: string) {
    setSelectedScopes(prev => (prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]))
  }

  function selectAll() {
    setSelectedScopes(ALL_KEYS)
  }
  function clearAll() {
    setSelectedScopes([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/service-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), allowed_scopes: selectedScopes }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create service account')
        return
      }
      setCreated(data)
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload() {
    if (!created) return
    const res = await fetch(created.download_url)
    if (!res.ok) {
      setError('Download failed or certificate already downloaded')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${created.name}.p12`
    a.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  async function copyPassword() {
    if (!created) return
    await navigator.clipboard.writeText(created.p12_password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Success page ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="p-4 sm:p-6 flex items-start justify-center min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-xl space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Service account created</h1>
              <p className="text-xs text-foreground-muted">
                Download the certificate bundle now — it cannot be retrieved again.
              </p>
            </div>
          </div>

          {/* Warning */}
          <div className="flex gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-4 py-3.5">
            <svg
              className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div className="text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
              <p className="font-semibold">One-time download only</p>
              <p>
                After downloading, the .p12 data is permanently deleted from the server. Store both the file and
                password in a secure secrets manager.
              </p>
            </div>
          </div>

          {/* Details card */}
          <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border-default">
              <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
                Certificate Details
              </p>
            </div>
            <div className="p-5 space-y-5">
              {/* Name */}
              <div>
                <p className="text-xs text-foreground-muted mb-1">Account Name</p>
                <p className="text-sm font-mono font-medium text-foreground">{created.name}</p>
              </div>

              {/* Password */}
              <div>
                <p className="text-xs text-foreground-muted mb-1.5">P12 Password</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2.5 bg-surface-secondary rounded-lg text-sm font-mono text-foreground border border-border-default break-all select-all">
                    {created.p12_password}
                  </code>
                  <button
                    type="button"
                    onClick={copyPassword}
                    className="shrink-0 p-2.5 rounded-lg bg-surface-secondary hover:bg-surface text-foreground-muted hover:text-foreground border border-border-default transition-colors"
                    title="Copy password"
                  >
                    {copied ? (
                      <svg
                        className="w-4 h-4 text-green-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-xs text-foreground-muted mt-1.5">
                  You will need this password to import the .p12 file into curl, openssl, or your keychain.
                </p>
              </div>

              {/* Download button */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloaded}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:bg-surface-secondary disabled:text-foreground-muted text-white font-medium text-sm transition-colors"
              >
                {downloaded ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Downloaded
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download {created.name}.p12
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Usage hint */}
          {downloaded && (
            <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border-default">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Usage</p>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-foreground-muted">
                  Extract cert and key from the .p12 bundle, then pass them to curl:
                </p>
                <pre className="text-xs font-mono bg-surface-secondary rounded-lg p-3 border border-border-default overflow-x-auto text-foreground-secondary whitespace-pre-wrap">{`openssl pkcs12 -in ${created.name}.p12 \\
  -clcerts -nokeys -out cert.pem -nodes
openssl pkcs12 -in ${created.name}.p12 \\
  -nocerts -out key.pem -nodes

curl --cert cert.pem --key key.pem \\
  -X POST https://admin.jeffistores.in/api/admin/replication/log \\
  -H 'Content-Type: application/json' \\
  -d '{"run_id":"test","status":"ok"}'`}</pre>
                <button
                  type="button"
                  onClick={() => router.push(ap('/admin/service-accounts'))}
                  className="w-full inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground text-sm font-medium transition-colors"
                >
                  Back to Service Accounts
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400 px-1">{error}</p>}
        </div>
      </div>
    )
  }

  // ── Create form ───────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(ap('/admin/service-accounts'))}
          className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Create Service Account</h1>
          <p className="text-sm text-foreground-muted mt-0.5">
            Generate an mTLS client certificate for M2M authentication
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Details */}
        <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
          </div>
          <div className="p-5 max-w-md space-y-1.5">
            <label
              htmlFor="sa-name"
              className="block text-xs font-medium text-foreground-muted uppercase tracking-wider"
            >
              Name
            </label>
            <input
              id="sa-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="razer-replication"
              pattern="[a-z0-9\-_]+"
              minLength={2}
              maxLength={80}
              required
              className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-secondary-400 transition"
            />
            <p className="text-xs text-foreground-muted">
              Lowercase letters, digits, hyphens and underscores only. Cert CN will be{' '}
              <code className="bg-surface-secondary px-1 rounded">svc-{name || '…'}</code>.
            </p>
          </div>
        </section>

        {/* Scopes */}
        <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Scopes</h2>
              <p className="text-xs text-foreground-muted mt-0.5">
                This account will only be permitted to call endpoints in the selected scopes.
                {selectedScopes.length > 0 && (
                  <span className="ml-2 text-secondary-500 font-medium">{selectedScopes.length} selected</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-xs font-medium">
              <button
                type="button"
                onClick={selectAll}
                className="px-2.5 py-1 rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors"
              >
                Select All
              </button>
              <span className="text-foreground-secondary">|</span>
              <button
                type="button"
                onClick={clearAll}
                className="px-2.5 py-1 rounded-md text-secondary-400 hover:text-secondary-300 hover:bg-surface-secondary transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="p-5 space-y-8">
            {Object.entries(SCOPE_GRID).map(([group, pairs]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">{group}</p>
                <div className="space-y-2">
                  {pairs.map(({ read, write }) => (
                    <div key={read?.key ?? write?.key} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {/* Read */}
                      {read ? (
                        <button
                          type="button"
                          onClick={() => toggleScope(read.key)}
                          className={`text-left rounded-xl border px-4 py-3 transition-all ${
                            selectedScopes.includes(read.key)
                              ? 'border-secondary-400 bg-secondary-500/10 dark:bg-secondary-500/15 shadow-sm'
                              : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-secondary/50'
                          }`}
                        >
                          <p
                            className={`text-sm font-semibold leading-tight ${selectedScopes.includes(read.key) ? 'text-secondary-400' : 'text-foreground'}`}
                          >
                            {read.label}
                          </p>
                          <p className="text-xs text-foreground-muted mt-0.5 leading-snug">{read.description}</p>
                        </button>
                      ) : (
                        <div />
                      )}

                      {/* Write */}
                      {write ? (
                        <button
                          type="button"
                          onClick={() => toggleScope(write.key)}
                          className={`text-left rounded-xl border px-4 py-3 transition-all ${
                            selectedScopes.includes(write.key)
                              ? 'border-amber-400 bg-amber-500/10 dark:bg-amber-500/15 shadow-sm'
                              : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-secondary/50'
                          }`}
                        >
                          <p
                            className={`text-sm font-semibold leading-tight ${selectedScopes.includes(write.key) ? 'text-amber-400' : 'text-foreground'}`}
                          >
                            {write.label}
                          </p>
                          <p className="text-xs text-foreground-muted mt-0.5 leading-snug">{write.description}</p>
                        </button>
                      ) : (
                        <div />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {error && <p className="text-sm text-red-600 dark:text-red-400 px-1">{error}</p>}

        <div className="flex items-center gap-3 pb-6">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating certificate…
              </>
            ) : (
              'Create Service Account'
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push(ap('/admin/service-accounts'))}
            className="px-5 py-2 rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
