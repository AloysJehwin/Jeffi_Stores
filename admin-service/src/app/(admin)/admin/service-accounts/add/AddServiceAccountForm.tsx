'use client'

import { useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { PageHeader } from '@/components/admin/kit/layout'
import { FormButton, FormField, FormFooter, FormPage, FormSection, TextInput } from '@/components/admin/kit/form'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import ScopeGrid from '@/components/admin/ScopeGrid'

interface Created {
  id: string
  name: string
  p12_password: string
  download_url: string
  api_key: string | null
}

export default function AddServiceAccountForm({ allowedKeys, host, publicOrigin }: { allowedKeys: string[]; host: string; publicOrigin: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const toast = useActionToast()
  const setError = (text: string) => text && toast.error(text)
  const [created, setCreated] = useState<Created | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)

  function toggleScope(key: string) {
    setSelectedScopes(prev => (prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]))
  }

  function selectAll() {
    setSelectedScopes(allowedKeys)
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

  async function copyKey() {
    if (!created?.api_key) return
    await navigator.clipboard.writeText(created.api_key)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }

  // ── Success page ──────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="p-4 sm:p-6 flex items-start justify-center min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-xl space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
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
          <div className="flex gap-3 bg-amber-500/5 border border-amber-500/40/40 rounded-xl px-4 py-3.5">
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
            <div className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
              <p className="font-semibold">One-time download only</p>
              <p>
                After downloading, the .p12 data is permanently deleted from the server. Store both the file and
                password in a secure secrets manager.
              </p>
            </div>
          </div>

          {/* API key: the public host's credential, shown once */}
          {created.api_key && (
            <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border-default">
                <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">API Key</p>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2.5 bg-surface-secondary rounded-lg text-xs font-mono text-foreground border border-border-default break-all select-all">
                    {created.api_key}
                  </code>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="shrink-0 px-3 h-control rounded-lg bg-surface-secondary hover:bg-surface text-xs text-foreground-muted hover:text-foreground border border-border-default transition-colors"
                  >
                    {keyCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-foreground-muted">
                  Shown only now. Call this store&apos;s API from anywhere with it, no certificate needed; it can do what this account&apos;s scopes allow. Revoke it under Settings → CLI &amp; tokens.
                </p>
                <pre className="text-xs font-mono bg-surface-secondary rounded-lg p-3 border border-border-default overflow-x-auto text-foreground-secondary whitespace-pre-wrap">{`curl ${publicOrigin}/v1/admin/service-accounts \\
  -H 'Authorization: Bearer ${created.api_key}'`}</pre>
                <p className="text-xs text-foreground-muted">
                  Every endpoint is listed at <a className="text-accent-500 hover:underline" href={`${publicOrigin}/docs`} target="_blank" rel="noreferrer">{publicOrigin.replace(/^https?:\/\//, '')}/docs</a>.
                </p>
              </div>
            </div>
          )}

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
  -X GET https://${host}/api/admin/service-accounts \\
  -H 'Accept: application/json'`}</pre>
                <button
                  type="button"
                  onClick={() => router.push(ap('/admin/service-accounts'))}
                  className="w-full inline-flex items-center justify-center px-4 h-control rounded-lg border border-border-default bg-surface hover:bg-surface-secondary text-foreground text-sm font-medium transition-colors"
                >
                  Back to Service Accounts
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    )
  }

  // ── Create form ───────────────────────────────────────────────────────────
  const cancel = () => router.push(ap('/admin/service-accounts'))
  return (
    <MobileEditBlock>
      <form onSubmit={handleSubmit}>
        <FormPage
          header={
            <PageHeader
              back={{ href: ap('/admin/service-accounts'), label: 'Service accounts' }}
              title="Create Service Account"
              description="Generate an mTLS client certificate for M2M authentication"
            />
          }
          footer={
            <FormFooter onCancel={cancel}>
              <FormButton disabled={loading || !name.trim()} pending={loading} pendingLabel="Generating certificate…">
                Create Service Account
              </FormButton>
            </FormFooter>
          }
        >
          <FormSection title="Details">
            <div className="max-w-md">
              <FormField
                label="Name"
                htmlFor="sa-name"
                required
                hint={
                  <>
                    Lowercase letters, digits, hyphens and underscores only. Cert CN will be{' '}
                    <code className="bg-surface-secondary px-1 rounded">svc-{name || '…'}</code>.
                  </>
                }
              >
                <TextInput
                  id="sa-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="razer-sync"
                  pattern="[a-z0-9\-_]+"
                  minLength={2}
                  maxLength={80}
                  required
                />
              </FormField>
            </div>
          </FormSection>

          <FormSection
            title="Scopes"
            description={
              <>
                This account will only be permitted to call endpoints in the selected scopes.
                {selectedScopes.length > 0 && <span className="ml-2 text-accent-500 font-medium">{selectedScopes.length} selected</span>}
              </>
            }
            aside={
              <div className="flex items-center gap-1 shrink-0 text-xs font-medium">
                <button type="button" onClick={selectAll} className="control-sm text-accent-500 hover:bg-surface-secondary">
                  Select All
                </button>
                <span className="text-foreground-secondary">|</span>
                <button type="button" onClick={clearAll} className="control-sm text-accent-500 hover:bg-surface-secondary">
                  Clear All
                </button>
              </div>
            }
          >
          <ScopeGrid selected={selectedScopes} onToggle={toggleScope} allowedKeys={allowedKeys} />
          </FormSection>
        </FormPage>
      </form>
    </MobileEditBlock>
  )
}
