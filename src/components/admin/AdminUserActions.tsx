'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ADMIN_SCOPES } from '@/lib/scopes'

interface AdminUser {
  id: string
  username: string
  role: string
  scopes: string[]
  is_active: boolean
  last_login: string | null
  created_at: string
  certificate_status?: string
  cert_expires_at?: string
}

export default function AdminUserActions({
  admin,
  currentAdminId,
  onUpdate,
}: {
  admin: AdminUser
  currentAdminId: string
  onUpdate?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scopes, setScopes] = useState<string[]>(admin.scopes || [])
  const [role, setRole] = useState(admin.role)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const isSelf = admin.id === currentAdminId
  const isSuperAdmin = admin.role === 'super_admin'

  function openEdit() {
    setScopes(admin.scopes || [])
    setRole(admin.role)
    setError(null)
    setEditing(true)
  }

  function toggleScope(key: string) {
    setScopes(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes, role }),
      })
      if (res.ok) {
        setEditing(false)
        onUpdate ? onUpdate() : router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleActive() {
    if (!confirm(`${admin.is_active ? 'Deactivate' : 'Activate'} ${admin.username}?`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !admin.is_active }),
      })
      if (res.ok) onUpdate ? onUpdate() : router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete ${admin.username}? This will revoke their certificates and permanently remove their account.`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'DELETE',
      })
      if (res.ok) onUpdate ? onUpdate() : router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const allSelected = scopes.length === ADMIN_SCOPES.length

  return (
    <>
      <div className="flex items-center gap-2">
        {!isSuperAdmin && !isSelf && (
          <>
            <button type="button" onClick={openEdit} className="text-accent-500 hover:text-accent-600 text-xs font-medium">
              Edit
            </button>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={loading}
              className={`text-xs font-medium ${admin.is_active ? 'text-red-500 hover:text-red-600' : 'text-green-500 hover:text-green-600'}`}
            >
              {admin.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" onClick={handleDelete} disabled={loading} className="text-red-600 hover:text-red-700 text-xs font-medium">
              Delete
            </button>
          </>
        )}
        {isSelf && <span className="text-xs text-foreground-muted">Current session</span>}
        {isSuperAdmin && !isSelf && <span className="text-xs text-foreground-muted">Super Admin</span>}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setEditing(false) }}
        >
          <div className="bg-surface-elevated rounded-2xl shadow-2xl border border-border-default w-full max-w-lg flex flex-col max-h-[90vh]">

            <div className="flex items-center justify-between px-6 py-4 border-b border-border-default shrink-0">
              <div>
                <h3 className="font-semibold text-foreground text-base">Edit admin</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{admin.username}</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="text-foreground-muted hover:text-foreground p-1.5 rounded-lg hover:bg-surface-secondary">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Role</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  className="w-full border border-border-secondary rounded-lg px-3 py-2.5 text-sm bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  disabled={isSuperAdmin}
                  aria-label="Role"
                >
                  <option value="admin">Admin</option>
                  <option value="moderator">Moderator</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Scopes
                    <span className="ml-2 text-xs font-normal text-foreground-muted">{scopes.length} of {ADMIN_SCOPES.length} selected</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setScopes(allSelected ? [] : ADMIN_SCOPES.map(s => s.key))}
                    className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ADMIN_SCOPES.map(scope => {
                    const active = scopes.includes(scope.key)
                    return (
                      <button
                        key={scope.key}
                        type="button"
                        onClick={() => toggleScope(scope.key)}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                          active
                            ? 'border-accent-500 bg-accent-500/10 dark:bg-accent-500/15'
                            : 'border-border-default bg-surface hover:border-border-secondary hover:bg-surface-secondary'
                        }`}
                      >
                        <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border ${
                          active ? 'bg-accent-500 border-accent-500' : 'border-border-secondary bg-surface'
                        }`}>
                          {active && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span>
                          <span className={`block text-xs font-semibold ${active ? 'text-accent-600 dark:text-accent-400' : 'text-foreground'}`}>
                            {scope.label}
                          </span>
                          <span className="block text-xs text-foreground-muted leading-relaxed mt-0.5">{scope.description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-default shrink-0">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-lg text-sm text-foreground-secondary bg-surface-secondary hover:bg-border-default transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
