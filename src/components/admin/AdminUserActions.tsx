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
  const router = useRouter()

  const isSelf = admin.id === currentAdminId
  const isSuperAdmin = admin.role === 'super_admin'

  async function handleSave() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes, role }),
      })
      if (res.ok) {
        setEditing(false)
        onUpdate ? onUpdate() : router.refresh()
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

  if (editing) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mt-2">
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            disabled={isSuperAdmin}
            aria-label="Role"
          >
            <option value="admin">Admin</option>
            <option value="moderator">Moderator</option>
          </select>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Scopes</label>
          <div className="flex flex-wrap gap-2">
            {ADMIN_SCOPES.map(scope => (
              <label
                key={scope.key}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer border ${
                  scopes.includes(scope.key)
                    ? 'border-accent-500 bg-accent-50 text-accent-700'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope.key)}
                  onChange={() => {
                    setScopes(prev =>
                      prev.includes(scope.key)
                        ? prev.filter(s => s !== scope.key)
                        : [...prev, scope.key]
                    )
                  }}
                  className="sr-only"
                />
                {scope.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="bg-accent-500 hover:bg-accent-600 text-white px-3 py-1 rounded text-xs font-medium"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {!isSuperAdmin && !isSelf && (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-accent-500 hover:text-accent-600 text-xs font-medium"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={loading}
            className={`text-xs font-medium ${
              admin.is_active
                ? 'text-red-500 hover:text-red-600'
                : 'text-green-500 hover:text-green-600'
            }`}
          >
            {admin.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="text-red-600 hover:text-red-700 text-xs font-medium"
          >
            Delete
          </button>
        </>
      )}
      {isSelf && <span className="text-xs text-gray-400">Current session</span>}
      {isSuperAdmin && !isSelf && <span className="text-xs text-gray-400">Super Admin</span>}
    </div>
  )
}
