'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomerHit, OrderHit } from '@/lib/customer-notes'
import type { CustomerNote } from '@/lib/customer-notes-shared'

export const MAX_FILES = 8

// All state and actions for the staff capture form, shared by the mobile and desktop variants so
// the two layouts never drift in behaviour.
export function useStaffNoteDraft(logoutEndpoint: string) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerHit[]>([])
  const [searching, setSearching] = useState(false)
  const [customer, setCustomer] = useState<CustomerHit | null>(null)
  const [orders, setOrders] = useState<OrderHit[]>([])
  const [orderId, setOrderId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [shared, setShared] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [audio, setAudio] = useState<{ blob: Blob; duration: number } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ warnings: string[] } | null>(null)
  const [recentNotes, setRecentNotes] = useState<CustomerNote[]>([])

  useEffect(() => {
    if (customer || query.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/staff/customers/search?q=${encodeURIComponent(query.trim())}`, {
          credentials: 'include',
        })
        if (res.status === 401) {
          router.refresh()
          return
        }
        const data = await res.json().catch(() => ({}))
        setResults(data.customers || [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, customer, router])

  const loadRecent = useCallback(async (customerId: string) => {
    const res = await fetch(`/api/staff/notes?customerId=${customerId}`, { credentials: 'include' }).catch(() => null)
    if (!res || !res.ok) {
      setRecentNotes([])
      return
    }
    const data = await res.json().catch(() => ({}))
    setRecentNotes(data.notes || [])
  }, [])

  useEffect(() => {
    if (!customer) {
      setOrders([])
      setOrderId('')
      setRecentNotes([])
      return
    }
    fetch(`/api/staff/orders/search?customerId=${customer.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setOrders(d.orders || []))
      .catch(() => setOrders([]))
    loadRecent(customer.id)
  }, [customer, loadRecent])

  const previews = useMemo(() => photos.map(f => ({ file: f, url: URL.createObjectURL(f) })), [photos])
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p.url)), [previews])

  const selectedOrder = orders.find(o => o.id === orderId) || null

  function addPhotos(list: FileList | File[] | null) {
    if (!list) return
    setPhotos(prev => [...prev, ...Array.from(list)].slice(0, MAX_FILES))
  }
  function removePhoto(i: number) {
    setPhotos(prev => prev.filter((_, j) => j !== i))
  }
  function toggleTag(t: string) {
    setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }
  function selectCustomer(c: CustomerHit) {
    setCustomer(c)
    setResults([])
  }
  function clearCustomer() {
    setCustomer(null)
    setQuery('')
  }
  function onScanResult(text: string) {
    setScanning(false)
    setCustomer(null)
    setQuery(text)
  }

  function reset(keepCustomer: boolean) {
    setTitle('')
    setBody('')
    setTags([])
    setShared(false)
    setPhotos([])
    setAudio(null)
    setOrderId('')
    setError('')
    setDone(null)
    if (!keepCustomer) clearCustomer()
  }

  const canSubmit = !!customer && (!!title.trim() || !!body.trim() || photos.length > 0 || !!audio)

  async function submit() {
    if (!customer) {
      setError('Pick a customer first')
      return
    }
    if (!canSubmit) {
      setError('Add a photo, a recording, or a note')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.set('customerId', customer.id)
      fd.set('title', title.trim())
      fd.set('body', body.trim())
      fd.set('tags', JSON.stringify(tags))
      if (orderId) fd.set('orderId', orderId)
      if (selectedOrder?.returnRequestId) fd.set('returnRequestId', selectedOrder.returnRequestId)
      fd.set('shared', shared ? 'true' : 'false')
      const durations: Record<string, number> = {}
      photos.forEach(f => fd.append('files', f))
      if (audio) {
        const ext = audio.blob.type.includes('mp4') ? 'm4a' : audio.blob.type.includes('ogg') ? 'ogg' : 'webm'
        fd.append('files', new File([audio.blob], `voice-memo.${ext}`, { type: audio.blob.type || 'audio/webm' }))
        durations[String(photos.length)] = audio.duration
      }
      fd.set('durations', JSON.stringify(durations))
      const res = await fetch('/api/staff/notes', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.refresh()
        return
      }
      if (!res.ok) {
        setError(data.error || 'Failed to save')
        return
      }
      setDone({ warnings: data.warnings || [] })
      loadRecent(customer.id)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    await fetch(logoutEndpoint, { method: 'POST' })
    router.refresh()
  }

  return {
    query,
    setQuery,
    results,
    searching,
    customer,
    selectCustomer,
    clearCustomer,
    orders,
    orderId,
    setOrderId,
    selectedOrder,
    title,
    setTitle,
    body,
    setBody,
    tags,
    toggleTag,
    shared,
    setShared,
    photos,
    previews,
    addPhotos,
    removePhoto,
    audio,
    setAudio,
    scanning,
    setScanning,
    onScanResult,
    submitting,
    error,
    done,
    canSubmit,
    submit,
    reset,
    logout,
    recentNotes,
  }
}

export type StaffNoteDraft = ReturnType<typeof useStaffNoteDraft>
