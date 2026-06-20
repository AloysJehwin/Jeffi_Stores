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

export default function AddServiceAccountPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [downloaded, setDownloaded] = useState(false)

  function toggleScope(key: string) {
    setSelectedScopes(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    )
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

  const scopeGroups = ADMIN_SCOPES.reduce<Record<string, typeof ADMIN_SCOPES>>((acc, s) => {
    const g = s.group || 'General'
    acc[g] = acc[g] || []
    acc[g].push(s)
    return acc
  }, {})

  if (created) {
    return (
      <div className="p-4 sm:p-6 max-w-lg">
        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Service account created</h2>
            <p className="text-xs text-foreground-muted mt-0.5">Download the certificate bundle now — it cannot be retrieved again.</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg px-4 py-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-semibold">One-time download</p>
              <p>The .p12 file is only available once. After downloading, the certificate data is deleted from the server.</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">Name</p>
              <p className="text-sm font-mono text-foreground">{created.name}</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">P12 Password</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-secondary rounded-lg text-sm font-mono text-foreground border border-border-default break-all">
                  {created.p12_password}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(created.p12_password)}
                  className="shrink-0 p-2 rounded-lg bg-surface-secondary hover:bg-surface text-foreground-muted hover:text-foreground border border-border-default transition-colors"
                  title="Copy password"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-foreground-muted">Save this password — you will need it to import the .p12 file.</p>
            </div>

            <button
              type="button"
              onClick={handleDownload}
              disabled={downloaded}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:bg-surface-secondary disabled:text-foreground-muted text-white font-medium text-sm transition-colors"
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download {created.name}.p12
                </>
              )}
            </button>

            {downloaded && (
              <button
                type="button"
                onClick={() => router.push(ap('/admin/service-accounts'))}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground text-sm font-medium transition-colors"
              >
                Back to Service Accounts
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
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
          <p className="text-sm text-foreground-muted mt-0.5">Generate an mTLS client certificate for M2M authentication</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="sa-name" className="block text-xs font-medium text-foreground-muted uppercase tracking-wider">
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
              <p className="text-xs text-foreground-muted">Lowercase letters, digits, hyphens and underscores only. The cert CN will be <code className="bg-surface-secondary px-1 rounded">svc-{name || '…'}</code>.</p>
            </div>
          </div>
        </section>

        <section className="bg-surface-elevated rounded-xl border border-border-default shadow-sm">
          <div className="px-5 py-4 border-b border-border-default">
            <h2 className="text-sm font-semibold text-foreground">Allowed Scopes</h2>
            <p className="text-xs text-foreground-muted mt-0.5">This account will only be permitted to call endpoints in these scopes.</p>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {Object.entries(scopeGroups).map(([group, scopes]) => (
              <div key={group} className="bg-surface rounded-lg border border-border-default p-4">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">{group}</p>
                <div className="space-y-2">
                  {scopes.map(scope => (
                    <label key={scope.key} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.key)}
                        onChange={() => toggleScope(scope.key)}
                        className="mt-0.5 rounded border-border-default text-secondary-500 focus:ring-secondary-400"
                      />
                      <div>
                        <p className="text-xs font-medium text-foreground group-hover:text-secondary-600 dark:group-hover:text-secondary-400 transition-colors">{scope.label}</p>
                        <p className="text-xs text-foreground-muted">{scope.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 px-1">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary-500 hover:bg-secondary-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating certificate…
              </>
            ) : 'Create Service Account'}
          </button>
          <button
            type="button"
            onClick={() => router.push(ap('/admin/service-accounts'))}
            className="px-4 py-2.5 rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
