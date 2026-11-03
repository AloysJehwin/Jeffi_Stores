'use client'

import { useState } from 'react'
import CouponUserPicker from './CouponUserPicker'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { InfiniteFooter, useServerPages } from '@/components/admin/kit/infinite'

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
  /** ?usersPage the server rendered and the full count; pages accumulate on scroll. */
  page: number
  total: number
}

export default function CouponEligibleUsersClient({ couponId, initialUsers, canRemove, canAdd, allUsersMode, page, total }: Props) {
  const canWrite = useCanWrite('coupons:write')
  const pages = useServerPages({ rows: initialUsers, page, total, rowKey: u => u.id, param: 'usersPage' })
  const [added, setAdded] = useState<EligibleUser[]>([])
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const addedIds = new Set(added.map(u => u.id))
  const users = [...added, ...pages.rows.filter(u => !addedIds.has(u.id))].filter(u => !removed.has(u.id))
  const [removing, setRemoving] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const existingIds = new Set(users.map(u => u.id))
  const showAdd = canAdd && canWrite
  const showRemove = canRemove && canWrite

  async function handleRemove(userId: string) {
    setRemoving(userId)
    try {
      const res = await fetch(`/api/admin/coupons/${couponId}/eligible-users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) setRemoved(prev => new Set(prev).add(userId))
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
      setRemoved(prev => {
        const n = new Set(prev)
        n.delete(user.id)
        return n
      })
      setAdded(prev => [
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
      {showAdd && (
        <div className="px-5 py-3 border-b border-border-default">
          {!showPicker ? (
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:text-accent-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
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
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  className="text-xs text-foreground-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <CouponUserPicker onAdd={handleAdd} existingIds={existingIds} />
            </div>
          )}
        </div>
      )}

      {/* Mobile card list */}
      <div className="md:hidden px-4 pb-3 pt-2 space-y-3">
        {users.length === 0 ? (
          <p className="py-6 text-center text-sm text-foreground-muted">No users found</p>
        ) : (
          users.map(u => (
            <div key={u.id} className="rounded-lg border border-border-default bg-surface-elevated p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '—'}
                  </p>
                  <p className="text-xs text-foreground-muted truncate">{u.email}</p>
                </div>
                {u.times_used > 0 ? (
                  <span className="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                    {u.times_used}x used
                  </span>
                ) : (
                  <span className="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-surface-secondary text-foreground-muted">
                    Not used
                  </span>
                )}
              </div>
              {showRemove && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={removing === u.id}
                    onClick={() => handleRemove(u.id)}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors font-medium"
                  >
                    {removing === u.id ? '…' : 'Remove'}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">
                Redeemed
              </th>
              {showRemove && <th className="px-4 py-3 w-16" />}
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
                  {u.times_used > 0 ? (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                      {u.times_used}x used
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-secondary text-foreground-muted">
                      Not used
                    </span>
                  )}
                </td>
                {showRemove && (
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
                <td colSpan={showRemove ? 4 : 3} className="px-4 py-6 text-center text-foreground-muted text-sm">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!pages.resetting && <InfiniteFooter shown={users.length} control={pages.control} noun="users" className="px-4 pb-3" />}
    </div>
  )
}
