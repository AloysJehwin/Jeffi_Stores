'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { bp } from '@/lib/business-path'
// BusinessAccountNavBar is rendered by layout.tsx for all /business/account/* pages

interface DashboardData {
  stats: { total_orders: number; total_spent: number; active_orders: number }
  recentOrders: Array<{
    id: string
    order_number: string
    created_at: string
    status: string
    total_amount: number
    items: Array<{ product_name: string; quantity: number; thumbnail_url: string | null }>
  }>
  defaultAddress: {
    full_name: string
    address_line1: string
    address_line2?: string
    landmark?: string
    city: string
    state: string
    postal_code: string
    phone: string
  } | null
}

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  confirmed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
  shipped: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
  out_for_delivery: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
  delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  cancel_requested: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
  return_requested: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
  returned: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
}

const statusLabel: Record<string, string> = {
  cancel_requested: 'Cancel Requested',
  out_for_delivery: 'Out for Delivery',
  return_requested: 'Return Requested',
  return_approved: 'Return Approved',
  return_received: 'Return Received',
  return_rejected: 'Return Rejected',
}

function getStatusLabel(s: string) {
  return statusLabel[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))
}

function getStatusColor(s: string) {
  return statusColor[s] ?? 'bg-surface-secondary text-foreground'
}

const PH = { 'X-Auth-Portal': 'business' }

export default function AccountPage() {
  const { user, isLoading, logout } = useAuth()
  const router = useRouter()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ firstName: '', lastName: '', phone: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropScale, setCropScale] = useState(1)
  const [cropFitScale, setCropFitScale] = useState(1)
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 })
  const cropDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const cropPinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const cropContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/user/search-history', { credentials: 'include', headers: PH })
      .then(r => r.ok ? r.json() : { history: [] })
      .then(data => setSearchHistory(Array.isArray(data.history) ? data.history : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(bp('/business/signin?redirect=/account'))
    }
    if (user) {
      setAvatarUrl(user.avatarUrl)
      setFormData({
        firstName: user.firstName,
        lastName: user.lastName || '',
        phone: (user.phone || '').replace(/^\+91/, ''),
      })
      fetch('/api/user/dashboard', { credentials: 'include', headers: PH })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.stats) setDashboard(d) })
        .catch(() => {})
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
        headers: { 'Content-Type': 'application/json', ...PH },
        credentials: 'include',
        body: JSON.stringify(formData),
      })
      if (!response.ok) throw new Error()
      setMessage('Profile updated successfully!')
      setIsEditing(false)
      window.location.reload()
    } catch {
      setMessage('Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setMessage('Photo must be under 10 MB'); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const CIRCLE = 240
      const fitScale = Math.max(CIRCLE / img.naturalWidth, CIRCLE / img.naturalHeight)
      setCropFitScale(fitScale)
      setCropScale(fitScale)
      setCropPos({ x: 0, y: 0 })
      setCropSrc(url)
      document.body.style.overflow = 'hidden'
    }
    img.src = url
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCropConfirm = useCallback(async () => {
    if (!cropSrc) return
    setAvatarUploading(true)
    setMessage('')
    try {
      const SIZE = 512
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = cropSrc
      })
      ctx.save()
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
      ctx.clip()
      const displaySize = 256
      const scaledW = img.naturalWidth * cropScale * (SIZE / displaySize)
      const scaledH = img.naturalHeight * cropScale * (SIZE / displaySize)
      const offsetX = (SIZE - scaledW) / 2 + cropPos.x * (SIZE / displaySize)
      const offsetY = (SIZE - scaledH) / 2 + cropPos.y * (SIZE / displaySize)
      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH)
      ctx.restore()
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/jpeg', 0.9)
      })
      const fd = new FormData()
      fd.append('file', blob, 'avatar.jpg')
      const res = await fetch('/api/user/avatar', { method: 'POST', body: fd, credentials: 'include', headers: PH })
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
      const data = await res.json()
      setAvatarUrl(data.avatarUrl + `?t=${Date.now()}`)
      setCropSrc(null)
      document.body.style.overflow = ''
    } catch (err: any) {
      setMessage(err.message || 'Failed to upload photo')
    } finally {
      setAvatarUploading(false)
    }
  }, [cropSrc, cropScale, cropPos])

  const handleCropMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    cropDragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: cropPos.x, startPosY: cropPos.y }
    const onMove = (ev: MouseEvent) => {
      if (!cropDragRef.current) return
      setCropPos({
        x: cropDragRef.current.startPosX + (ev.clientX - cropDragRef.current.startX),
        y: cropDragRef.current.startPosY + (ev.clientY - cropDragRef.current.startY),
      })
    }
    const onUp = () => {
      cropDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleCropTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      cropDragRef.current = { startX: t.clientX, startY: t.clientY, startPosX: cropPos.x, startPosY: cropPos.y }
      cropPinchRef.current = null
    } else if (e.touches.length === 2) {
      cropDragRef.current = null
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      cropPinchRef.current = { dist: Math.hypot(dx, dy), scale: cropScale }
    }
  }

  const handleCropTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1 && cropDragRef.current) {
      const t = e.touches[0]
      setCropPos({
        x: cropDragRef.current.startPosX + (t.clientX - cropDragRef.current.startX),
        y: cropDragRef.current.startPosY + (t.clientY - cropDragRef.current.startY),
      })
    } else if (e.touches.length === 2 && cropPinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const next = Math.min(cropFitScale * 4, Math.max(cropFitScale, cropPinchRef.current.scale * (dist / cropPinchRef.current.dist)))
      setCropScale(next)
    }
  }

  const handleCropWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setCropScale(s => Math.min(cropFitScale * 4, Math.max(cropFitScale, s - e.deltaY * 0.002 * cropFitScale)))
  }

  useEffect(() => {
    return () => { document.body.style.overflow = '' }
  }, [])

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

  if (!user) return null

  return (
    <div className="bg-surface min-h-screen">

      {/* Hero header — mobile only */}
      <div className="bg-gradient-to-br from-accent-600 to-accent-500 dark:from-accent-700 dark:to-accent-600 px-4 pt-8 pb-6 lg:hidden">
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarUploading}
            className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 group ring-2 ring-white/30"
            aria-label="Change profile photo"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white">
                {user.firstName?.[0]?.toUpperCase() || 'U'}
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
              {avatarUploading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </div>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-white leading-tight truncate">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-white/70 truncate">{user.email}</p>
          </div>
          <button
            onClick={logout}
            className="flex-shrink-0 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
            title="Sign out"
          >
            <svg className="w-4 h-4 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
        {/* Inline stats */}
        <div className="grid grid-cols-3 gap-2 mt-5">
          <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">{dashboard?.stats?.total_orders ?? '—'}</p>
            <p className="text-[10px] text-white/70 mt-0.5">Total Orders</p>
          </div>
          <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-sm font-bold text-white leading-tight">
              {dashboard ? `₹${Number(dashboard.stats?.total_spent ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
            </p>
            <p className="text-[10px] text-white/70 mt-0.5">Total Spent</p>
          </div>
          <div className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">{dashboard?.stats?.active_orders ?? '—'}</p>
            <p className="text-[10px] text-white/70 mt-0.5">Active</p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4">
        <div className="py-4 sm:py-6 space-y-4 max-w-3xl lg:max-w-none">

            {/* Desktop stats row */}
            <div className="hidden lg:grid grid-cols-3 gap-3">
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground leading-none">{dashboard?.stats?.total_orders ?? '—'}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">Total Orders</p>
                </div>
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-bold text-foreground leading-none">
                    {dashboard ? `₹${Number(dashboard.stats?.total_spent ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                  </p>
                  <p className="text-xs text-foreground-muted mt-0.5">Total Spent</p>
                </div>
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xl font-bold text-accent-600 dark:text-accent-400 leading-none">{dashboard?.stats?.active_orders ?? '—'}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">Active Orders</p>
                </div>
              </div>
            </div>

            {/* Recent Searches */}
            {searchHistory.length > 0 && (
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Recent Searches</h2>
                  <button
                    onClick={() => {
                      fetch('/api/user/search-history', { method: 'DELETE', credentials: 'include', headers: PH }).catch(() => {})
                      setSearchHistory([])
                    }}
                    className="text-xs text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {searchHistory.map(q => (
                    <Link
                      key={q}
                      href={bp(`/business/products?search=${encodeURIComponent(q)}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border-secondary text-xs text-foreground-secondary hover:text-accent-600 hover:border-accent-300 dark:hover:text-accent-400 dark:hover:border-accent-700 transition-colors"
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {q}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Profile + Default Address row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-foreground">Profile</h2>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {message && (
                  <div className={`mb-3 p-2.5 rounded-lg text-xs ${message.includes('success') ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                    {message}
                  </div>
                )}

                {!isEditing ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="relative w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 group"
                        aria-label="Change profile photo"
                      >
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center text-lg font-bold text-accent-600 dark:text-accent-400">
                            {user.firstName?.[0]?.toUpperCase() || 'U'}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                          {avatarUploading ? (
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </div>
                      </button>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">{user.firstName} {user.lastName}</p>
                        <p className="text-xs text-foreground-muted truncate">{user.email}</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border-default space-y-2">
                      <div className="flex justify-between">
                        <span className="text-xs text-foreground-muted">Phone</span>
                        <span className="text-xs font-medium text-foreground">
                          {user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-foreground-muted">Member since</span>
                        <span className="text-xs font-medium text-foreground">
                          {new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSave} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">First Name *</label>
                        <input
                          type="text"
                          required
                          value={formData.firstName}
                          onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground-secondary mb-1">Last Name</label>
                        <input
                          type="text"
                          value={formData.lastName}
                          onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Phone</label>
                      <div className="flex">
                        <span className="inline-flex items-center px-2.5 py-2 border border-r-0 border-border-secondary rounded-l-lg bg-surface text-foreground-secondary text-xs font-medium">+91</span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          value={formData.phone}
                          onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                          className="w-full px-3 py-2 border border-border-secondary rounded-r-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                          placeholder="00000 00000"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="submit" disabled={isSaving} className="flex-1 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-xs transition-colors disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center justify-center">
                        {isSaving ? <><div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full mr-1.5"></div>Saving...</> : 'Save'}
                      </button>
                      <button type="button" disabled={isSaving} onClick={() => { setIsEditing(false); setFormData({ firstName: user.firstName, lastName: user.lastName || '', phone: (user.phone || '').replace(/^\+91/, '') }) }} className="flex-1 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-semibold text-xs transition-colors disabled:opacity-50">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Default address */}
              <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-foreground">Default Address</h2>
                  <Link href={bp('/business/account/addresses')} className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors">
                    Manage
                  </Link>
                </div>
                {dashboard?.defaultAddress ? (
                  <div className="space-y-1 text-sm text-foreground-secondary">
                    <p className="font-semibold text-foreground text-sm">{dashboard.defaultAddress.full_name}</p>
                    <p className="text-xs">{dashboard.defaultAddress.address_line1}</p>
                    {dashboard.defaultAddress.address_line2 && <p className="text-xs">{dashboard.defaultAddress.address_line2}</p>}
                    {dashboard.defaultAddress.landmark && <p className="text-xs text-foreground-muted">Near {dashboard.defaultAddress.landmark}</p>}
                    <p className="text-xs">{dashboard.defaultAddress.city}, {dashboard.defaultAddress.state} — {dashboard.defaultAddress.postal_code}</p>
                    <p className="text-xs text-foreground-muted pt-1">{dashboard.defaultAddress.phone}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-24 text-center">
                    <p className="text-xs text-foreground-muted mb-2">No default address saved</p>
                    <Link href={bp('/business/account/addresses')} className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium underline underline-offset-2">
                      Add an address
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground">Recent Orders</h2>
                <Link href={bp('/business/account/orders')} className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium">
                  View all
                </Link>
              </div>
              {dashboard?.recentOrders.length === 0 || !dashboard ? (
                <div className="text-center py-6">
                  <p className="text-sm text-foreground-muted mb-3">No orders yet</p>
                  <Link href={bp('/business/products')} className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium underline underline-offset-2">
                    Start shopping
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {dashboard.recentOrders.map(order => (
                    <Link key={order.id} href={bp(`/business/account/orders/${order.id}`)} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface transition-colors group border border-transparent hover:border-border-default">
                      <div className="flex -space-x-2 flex-shrink-0">
                        {order.items.slice(0, 3).map((item, i) => (
                          <div key={i} className="w-10 h-10 rounded-lg border-2 border-surface-elevated overflow-hidden bg-surface flex items-center justify-center flex-shrink-0">
                            {item.thumbnail_url ? (
                              <img src={item.thumbnail_url} alt="" aria-hidden className="w-full h-full object-cover" />
                            ) : (
                              <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-foreground-muted">#{order.order_number}</p>
                        <p className="text-sm font-medium text-foreground truncate">
                          {order.items[0]?.product_name}
                          {order.items.length > 1 && <span className="text-foreground-muted"> +{order.items.length - 1} more</span>}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold text-foreground">₹{Number(order.total_amount).toLocaleString('en-IN')}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Sign out — mobile only (desktop handled by sidebar) */}
            <div className="lg:hidden">
              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>

          </div>
        </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleAvatarChange}
      />

      {cropSrc && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface-elevated rounded-2xl shadow-2xl border border-border-default w-full max-w-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
              <button
                onClick={() => { setCropSrc(null); document.body.style.overflow = '' }}
                className="text-foreground-muted hover:text-foreground transition-colors"
                aria-label="Cancel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <span className="font-semibold text-foreground text-sm">Adjust Photo</span>
              <button
                onClick={handleCropConfirm}
                disabled={avatarUploading}
                className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {avatarUploading ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : 'Save'}
              </button>
            </div>

            <div className="flex flex-col items-center gap-5 p-6 bg-surface">
              <div
                ref={cropContainerRef}
                className="relative overflow-hidden rounded-full flex-shrink-0 cursor-grab active:cursor-grabbing select-none ring-4 ring-accent-500/30"
                style={{ width: 240, height: 240 }}
                onMouseDown={handleCropMouseDown}
                onTouchStart={handleCropTouchStart}
                onTouchMove={handleCropTouchMove}
                onWheel={handleCropWheel}
              >
                <img
                  src={cropSrc}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) translate(${cropPos.x}px, ${cropPos.y}px) scale(${cropScale})`,
                    transformOrigin: 'center',
                    maxWidth: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  } as React.CSSProperties}
                />
              </div>

              <div className="w-full flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                  </svg>
                  <input
                    type="range"
                    min={100}
                    max={400}
                    step={1}
                    value={Math.round((cropScale / cropFitScale) * 100)}
                    onChange={e => setCropScale(cropFitScale * (Number(e.target.value) / 100))}
                    className="flex-1 accent-accent-500"
                  />
                  <svg className="w-5 h-5 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7m6 0h-6" />
                  </svg>
                </div>
                <p className="text-center text-xs text-foreground-muted">Drag to reposition · Scroll or pinch to zoom</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
