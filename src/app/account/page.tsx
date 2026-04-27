'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'

export default function AccountPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login?redirect=/account')
    }
    if (user) {
      setFormData({
        firstName: user.firstName,
        lastName: user.lastName || '',
        phone: (user.phone || '').replace(/^\+91/, ''),
      })
    }
  }, [user, isLoading, router])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.phone && formData.phone.length !== 10) {
      setMessage('Enter a valid 10-digit mobile number')
      return
    }
    setIsSaving(true)
    setMessage('')

    try {
      const response = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error('Failed to update profile')
      }

      setMessage('Profile updated successfully!')
      setIsEditing(false)
      window.location.reload()
    } catch (error) {
      setMessage('Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="bg-surface min-h-screen">

      {/* Mobile header card */}
      <div className="lg:hidden bg-accent-500 pt-8 pb-16 px-4 relative">
        <h1 className="text-lg font-semibold text-white/80 mb-4">My Account</h1>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {user.firstName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-xl font-bold text-white">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-white/70 mt-0.5">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Mobile nav tabs — overlapping the header */}
      <div className="lg:hidden relative z-10 mx-4 -mt-8 mb-4">
        <div className="bg-surface-elevated rounded-xl shadow-md border border-border-default overflow-hidden">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? 'text-accent-600 border-accent-500 dark:text-accent-400'
                      : 'text-foreground-muted border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-accent-500' : 'text-foreground-muted'}>{item.icon}</span>
                  <span className="leading-tight text-center" style={{ fontSize: '10px' }}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 pb-16 lg:py-8 lg:pb-8">
        <div className="hidden lg:block mb-8">
          <h1 className="text-3xl font-bold text-foreground">My Account</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="hidden lg:block lg:col-span-1">
            <AccountSidebar />
          </div>

          <div className="lg:col-span-3">
            <div className="bg-surface-elevated rounded-xl shadow-sm border border-border-default p-4 sm:p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-foreground">Profile Information</h2>
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-sm text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-3 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>

              {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('success') ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                  {message}
                </div>
              )}

              {!isEditing ? (
                <div className="divide-y divide-border-default">
                  <div className="flex items-center justify-between py-3">
                    <span className="text-sm text-foreground-muted">Email</span>
                    <span className="text-sm font-medium text-foreground text-right max-w-[60%] truncate">{user.email}</span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-sm text-foreground-muted">First Name</span>
                    <span className="text-sm font-medium text-foreground">{user.firstName}</span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-sm text-foreground-muted">Last Name</span>
                    <span className="text-sm font-medium text-foreground">{user.lastName || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-sm text-foreground-muted">Phone</span>
                    <span className="text-sm font-medium text-foreground">
                      {user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-sm text-foreground-muted">Member Since</span>
                    <span className="text-sm font-medium text-foreground">
                      {new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Email</label>
                    <input
                      type="email"
                      disabled
                      value={user.email}
                      className="w-full px-4 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground-muted text-sm"
                    />
                    <p className="mt-1 text-xs text-foreground-muted">Email cannot be changed</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground-secondary mb-1.5">First Name *</label>
                      <input
                        type="text"
                        required
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        className="w-full px-4 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Last Name</label>
                      <input
                        type="text"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        className="w-full px-4 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Phone Number</label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 py-2.5 border border-r-0 border-border-secondary rounded-l-lg bg-surface text-foreground-secondary text-sm font-medium">
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                        className="w-full px-4 py-2.5 border border-border-secondary rounded-r-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        placeholder="98765 43210"
                      />
                    </div>
                    {formData.phone && formData.phone.length > 0 && formData.phone.length !== 10 && (
                      <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
                    )}
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex-1 py-2.5 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                          Saving...
                        </>
                      ) : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setIsEditing(false)
                        setFormData({
                          firstName: user.firstName,
                          lastName: user.lastName || '',
                          phone: (user.phone || '').replace(/^\+91/, ''),
                        })
                      }}
                      className="flex-1 py-2.5 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
