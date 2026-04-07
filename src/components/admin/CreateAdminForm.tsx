'use client'

import { useState } from 'react'
import { ADMIN_SCOPES } from '@/lib/scopes'

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

      // Download the p12 certificate file
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

      // Show certificate password
      setCertInfo({
        p12Password: data.certificate.p12Password,
        username: form.username,
        serialNumber: data.certificate.serialNumber,
        expiresAt: data.certificate.expiresAt,
      })

      // Reset form
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
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-green-800 mb-4">Admin Created Successfully</h3>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-green-700">Username</p>
            <p className="font-mono font-bold text-green-900">{certInfo.username}</p>
          </div>
          <div>
            <p className="text-sm text-green-700">Certificate Password (one-time view)</p>
            <p className="font-mono font-bold text-green-900 bg-green-100 px-3 py-2 rounded select-all">
              {certInfo.p12Password}
            </p>
          </div>
          <div>
            <p className="text-sm text-green-700">Certificate Serial</p>
            <p className="font-mono text-xs text-green-800">{certInfo.serialNumber}</p>
          </div>
          <div>
            <p className="text-sm text-green-700">Expires</p>
            <p className="text-green-800">{new Date(certInfo.expiresAt).toLocaleDateString('en-IN')}</p>
          </div>
        </div>
        <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded mt-4">
          The .p12 certificate file has been downloaded. Save the password above — it will not be shown again.
        </p>
        <button
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
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
          <input
            type="text"
            required
            value={form.first_name}
            onChange={e => setForm(prev => ({ ...prev, first_name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
          <input
            type="text"
            required
            value={form.last_name}
            onChange={e => setForm(prev => ({ ...prev, last_name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
        <input
          type="email"
          required
          value={form.email}
          onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
          <input
            type="text"
            required
            value={form.username}
            onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
        <select
          value={form.role}
          onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-accent-500 focus:border-accent-500"
        >
          <option value="admin">Admin</option>
          <option value="moderator">Moderator</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Scopes</label>
          <div className="flex gap-2">
            <button type="button" onClick={selectAllScopes} className="text-xs text-accent-500 hover:text-accent-600">
              Select All
            </button>
            <span className="text-xs text-gray-300">|</span>
            <button type="button" onClick={clearAllScopes} className="text-xs text-gray-500 hover:text-gray-600">
              Clear All
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {ADMIN_SCOPES.map(scope => (
            <label
              key={scope.key}
              className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                form.scopes.includes(scope.key)
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={form.scopes.includes(scope.key)}
                onChange={() => toggleScope(scope.key)}
                className="mt-0.5 accent-accent-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{scope.label}</p>
                <p className="text-xs text-gray-500">{scope.description}</p>
              </div>
            </label>
          ))}
        </div>
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
          className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-semibold text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
