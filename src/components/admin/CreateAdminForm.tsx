'use client'

import { useState } from 'react'
import { ADMIN_SCOPES } from '@/lib/scopes'
import ScopeGrid from '@/components/admin/ScopeGrid'

export default function CreateAdminForm({ onCreated }: { onCreated?: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [certInfo, setCertInfo] = useState<{
    p12Password: string
    username: string
    serialNumber: string
    expiresAt: string
  } | null>(null)

  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    first_name: '',
    last_name: '',
    role: 'admin',
    scopes: [] as string[],
  })

  function toggleScope(scope: string) {
    setForm(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes, scope],
    }))
  }

  function selectAllScopes() {
    setForm(prev => ({
      ...prev,
      scopes: ADMIN_SCOPES.map(s => s.key),
    }))
  }

  function clearAllScopes() {
    setForm(prev => ({ ...prev, scopes: [] }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create admin')
        return
      }

      if (data.certificate?.p12Base64) {
        const binary = atob(data.certificate.p12Base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: 'application/x-pkcs12' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${form.username}-admin-cert.p12`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }

      setCertInfo({
        p12Password: data.certificate.p12Password,
        username: form.username,
        serialNumber: data.certificate.serialNumber,
        expiresAt: data.certificate.expiresAt,
      })

      setForm({
        username: '',
        password: '',
        email: '',
        first_name: '',
        last_name: '',
        role: 'admin',
        scopes: [],
      })

      onCreated?.()
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (certInfo) {
    return (
      <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6">
        <h3 className="text-lg font-bold text-green-800 dark:text-green-300 mb-4">Admin Created Successfully</h3>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-green-700 dark:text-green-400">Username</p>
            <p className="font-mono font-bold text-green-900 dark:text-green-200">{certInfo.username}</p>
          </div>
          <div>
            <p className="text-sm text-green-700 dark:text-green-400">Certificate Password (one-time view)</p>
            <p className="font-mono font-bold text-green-900 dark:text-green-200 bg-green-100 dark:bg-green-800/50 px-3 py-2 rounded select-all">
              {certInfo.p12Password}
            </p>
          </div>
          <div>
            <p className="text-sm text-green-700 dark:text-green-400">Certificate Serial</p>
            <p className="font-mono text-xs text-green-800 dark:text-green-300">{certInfo.serialNumber}</p>
          </div>
          <div>
            <p className="text-sm text-green-700 dark:text-green-400">Expires</p>
            <p className="text-green-800 dark:text-green-300">{new Date(certInfo.expiresAt).toLocaleDateString('en-IN')}</p>
          </div>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded mt-4">
          The .p12 certificate file has been downloaded. Save the password above — it will not be shown again.
        </p>
        <button
          type="button"
          onClick={() => { setCertInfo(null); setIsOpen(false) }}
          className="mt-4 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          Done
        </button>
      </div>
    )
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      >
        Create New Admin
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="admin-first-name" className="block text-sm font-medium text-foreground-secondary mb-1">First Name *</label>
          <input
            id="admin-first-name"
            type="text"
            required
            value={form.first_name}
            onChange={e => setForm(prev => ({ ...prev, first_name: e.target.value }))}
            className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
        <div>
          <label htmlFor="admin-last-name" className="block text-sm font-medium text-foreground-secondary mb-1">Last Name *</label>
          <input
            id="admin-last-name"
            type="text"
            required
            value={form.last_name}
            onChange={e => setForm(prev => ({ ...prev, last_name: e.target.value }))}
            className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
      </div>

      <div>
        <label htmlFor="admin-email" className="block text-sm font-medium text-foreground-secondary mb-1">Email *</label>
        <input
          id="admin-email"
          type="email"
          required
          value={form.email}
          onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
          className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted focus:ring-accent-500 focus:border-accent-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="admin-username" className="block text-sm font-medium text-foreground-secondary mb-1">Username *</label>
          <input
            id="admin-username"
            type="text"
            required
            value={form.username}
            onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
            className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
        <div>
          <label htmlFor="admin-password" className="block text-sm font-medium text-foreground-secondary mb-1">Password *</label>
          <input
            id="admin-password"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
            className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-foreground-muted focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
      </div>

      <div>
        <label htmlFor="admin-role" className="block text-sm font-medium text-foreground-secondary mb-1">Role</label>
        <select
          id="admin-role"
          value={form.role}
          onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
          className="w-full border border-border-secondary rounded-lg px-3 py-2 text-sm bg-surface text-foreground focus:ring-accent-500 focus:border-accent-500"
        >
          <option value="admin">Admin</option>
          <option value="moderator">Moderator</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground-secondary">Scopes</label>
          <div className="flex gap-2">
            <button type="button" onClick={selectAllScopes} className="text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400">
              Select All
            </button>
            <span className="text-xs text-foreground-muted">|</span>
            <button type="button" onClick={clearAllScopes} className="text-xs text-foreground-muted hover:text-foreground-secondary">
              Clear All
            </button>
          </div>
        </div>
        <ScopeGrid selected={form.scopes} onToggle={toggleScope} variant="card" />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-accent-500 hover:bg-accent-600 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-semibold text-sm transition-colors"
        >
          {loading ? 'Creating...' : 'Create Admin & Generate Certificate'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="bg-surface-secondary hover:bg-border-default text-foreground-secondary px-6 py-2 rounded-lg font-semibold text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
