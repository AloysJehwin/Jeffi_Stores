'use client'

import { useState } from 'react'
import CouponUserPicker from './CouponUserPicker'

interface EligibleUser {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  times_used: number
}

interface Props {
  couponId: string
  initialUsers: EligibleUser[]
  canRemove: boolean
  canAdd: boolean
  allUsersMode: boolean
}

export default function CouponEligibleUsersClient({ couponId, initialUsers, canRemove, canAdd, allUsersMode }: Props) {
  const [users, setUsers] = useState<EligibleUser[]>(initialUsers)
  const [removing, setRemoving] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const existingIds = new Set(users.map(u => u.id))

  async function handleRemove(userId: string) {
    setRemoving(userId)
    try {
      const res = await fetch(`/api/admin/coupons/${couponId}/eligible-users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) setUsers(prev => prev.filter(u => u.id !== userId))
    } finally {
      setRemoving(null)
    }
  }

  async function handleAdd(user: { id: string; full_name: string; email: string }) {
    const res = await fetch(`/api/admin/coupons/${couponId}/eligible-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id }),
    })
    if (res.ok) {
      const nameParts = (user.full_name || '').trim().split(' ')
      setUsers(prev => [
        {
          id: user.id,
          email: user.email,
          first_name: nameParts[0] || null,
          last_name: nameParts.slice(1).join(' ') || null,
          times_used: 0,
        },
        ...prev,
      ])
    }
  }

  return (
    <div>
      {canAdd && (
        <div className="px-5 py-3 border-b border-border-default">
          {!showPicker ? (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:text-accent-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              {allUsersMode ? 'Restrict to specific users' : 'Add user'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground-secondary">
                  {allUsersMode
                    ? 'Adding users will restrict this coupon — only they can redeem it'
                    : 'Search and add a user'}
                </p>
                <button type="button" onClick={() => setShowPicker(false)} className="text-xs text-foreground-muted hover:text-foreground">
                  Cancel
                </button>
              </div>
              <CouponUserPicker onAdd={handleAdd} existingIds={existingIds} />
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">User</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Redeemed</th>
              {canRemove && <th className="px-4 py-3 w-16"/>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-surface-secondary/50 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">
                  {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '—'}
                </td>
                <td className="px-4 py-3 text-foreground-secondary">{u.email}</td>
                <td className="px-4 py-3">
                  {u.times_used > 0
                    ? <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">{u.times_used}x used</span>
                    : <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-secondary text-foreground-muted">Not used</span>}
                </td>
                {canRemove && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={removing === u.id}
                      onClick={() => handleRemove(u.id)}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors font-medium"
                    >
                      {removing === u.id ? '…' : 'Remove'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={canRemove ? 4 : 3} className="px-4 py-6 text-center text-foreground-muted text-sm">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
