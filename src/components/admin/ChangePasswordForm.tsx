'use client'

import { useState } from 'react'

interface ChangePasswordFormProps {
  adminId?: string
}

export default function ChangePasswordForm({ adminId }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    // Validation
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long')
      setIsSubmitting(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to change password')
      }

      setSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err.message || 'Failed to change password. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-300 text-sm">
          {success}
        </div>
      )}

      <div>
        <label htmlFor="current_password" className="block text-sm font-medium text-foreground-secondary mb-2">
          Current Password
        </label>
        <input
          type="password"
          id="current_password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          placeholder="Enter current password"
        />
      </div>

      <div>
        <label htmlFor="new_password" className="block text-sm font-medium text-foreground-secondary mb-2">
          New Password
        </label>
        <input
          type="password"
          id="new_password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          placeholder="Enter new password (min 8 characters)"
        />
      </div>

      <div>
        <label htmlFor="confirm_password" className="block text-sm font-medium text-foreground-secondary mb-2">
          Confirm New Password
        </label>
        <input
          type="password"
          id="confirm_password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
          placeholder="Confirm new password"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Changing Password...' : 'Change Password'}
      </button>
    </form>
  )
}
