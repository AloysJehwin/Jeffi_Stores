'use client'

import { useEffect, useState, useCallback } from 'react'

interface Cert {
  serial: string
  commonName: string
  role: string | null
  storeName: string | null
  expiresAt: string
  downloadedAt: string | null
  status: 'available' | 'downloaded' | 'revoked' | 'expired'
}

const STATUS_STYLE: Record<string, string> = {
  available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  downloaded: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  expired: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
}
const STATUS_LABEL: Record<string, string> = {
  available: 'Available', downloaded: 'Downloaded', revoked: 'Revoked', expired: 'Expired',
}

export default function CertList() {
  const [certs, setCerts] = useState<Cert[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [password, setPassword] = useState<{ serial: string; value: string } | null>(null)

  const load = useCallback(() => {
    fetch('/api/certportal/certs', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Please sign in again.'))))
      .then(d => setCerts(Array.isArray(d.certs) ? d.certs : []))
      .catch(e => setError(e.message))
  }, [])

  useEffect(() => { load() }, [load])

  async function download(serial: string, cn: string) {
    setBusy(serial)
    setError(null)
    setPassword(null)
    try {
      const res = await fetch(`/api/certportal/certs/${encodeURIComponent(serial)}/download`, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Download failed')
      }
      const pwd = res.headers.get('X-Cert-Password') || ''
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${cn.replace(/[^a-zA-Z0-9._@-]/g, '_')}.p12`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      if (pwd) setPassword({ serial, value: pwd })
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (error && !certs) return <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!certs) return <p className="mt-6 text-sm text-foreground-muted">Loading…</p>
  if (certs.length === 0) {
    return (
      <p className="mt-6 text-sm text-foreground-secondary">
        No certificates are associated with this Google account. If you were invited, make sure you
        signed in with the exact email the invitation was sent to.
      </p>
    )
  }

  return (
    <div className="mt-6 space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {certs.map(c => (
        <div key={c.serial} className="rounded-lg border border-border-default bg-surface-elevated p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">{c.storeName || 'Jeffi Stores'}</p>
              <p className="text-sm text-foreground-secondary">{c.commonName}{c.role ? ` · ${c.role}` : ''}</p>
              <p className="text-xs text-foreground-muted mt-1">
                Expires {new Date(c.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {c.downloadedAt ? ` · downloaded ${new Date(c.downloadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </p>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[c.status]}`}>
              {STATUS_LABEL[c.status]}
            </span>
          </div>

          {c.status === 'available' && (
            <button
              onClick={() => download(c.serial, c.commonName)}
              disabled={busy === c.serial}
              className="mt-3 w-full px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {busy === c.serial ? 'Downloading…' : 'Download certificate (once)'}
            </button>
          )}

          {password?.serial === c.serial && (
            <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Import password</p>
              <p className="mt-1 font-mono text-sm text-foreground break-all select-all">{password.value}</p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                You will need this password when installing the certificate. It is shown only now —
                copy it before leaving this page.
              </p>
            </div>
          )}
        </div>
      ))}

      <InstallHelp />
    </div>
  )
}

function InstallHelp() {
  return (
    <details className="mt-6 rounded-lg border border-border-default bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground">How to install the certificate</summary>
      <div className="mt-3 space-y-3 text-sm text-foreground-secondary">
        <div>
          <p className="font-medium text-foreground">macOS (Keychain)</p>
          <p>Double-click the .p12, enter the import password, then set the certificate to &quot;Always Trust&quot; in Keychain Access.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Windows</p>
          <p>Double-click the .p12 to open the Certificate Import Wizard, choose &quot;Current User&quot;, enter the password, and let Windows select the store automatically.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Chrome / Linux</p>
          <p>Settings &gt; Privacy and security &gt; Security &gt; Manage certificates &gt; Your certificates &gt; Import, then choose the .p12 and enter the password.</p>
        </div>
        <div>
          <p className="font-medium text-foreground">Certificate not working?</p>
          <p>Make sure you imported into the same browser/profile you use for the admin panel, restart the browser, and confirm the certificate is not expired or revoked above. If it still fails, ask a super admin to re-issue it.</p>
        </div>
      </div>
    </details>
  )
}
