'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NOTE_TAGS } from '@/lib/customer-notes-shared'
import StaffVoiceMemo from './StaffVoiceMemo'
import StaffQrScanner from './StaffQrScanner'

interface CustomerHit { id: string; name: string; email: string | null; phone: string | null; lastOrderNumber: string | null }
interface OrderHit { id: string; orderNumber: string; status: string; createdAt: string; total: number; returnRequestId: string | null }

const inputClass = 'w-full px-4 py-3 border border-border-secondary rounded-xl bg-surface text-foreground text-base placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'
const MAX_FILES = 8

export default function StaffNotesForm({ storeName, staff }: { storeName: string; staff: { email: string; name: string | null } }) {
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
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (customer || query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/staff/customers/search?q=${encodeURIComponent(query.trim())}`, { credentials: 'include' })
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) { router.refresh(); return }
        setResults(data.customers || [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, customer, router])

  useEffect(() => {
    if (!customer) { setOrders([]); setOrderId(''); return }
    fetch(`/api/staff/orders/search?customerId=${customer.id}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setOrders(d.orders || [])).catch(() => setOrders([]))
  }, [customer])

  const selectedOrder = orders.find(o => o.id === orderId) || null
  const previews = photos.map(f => ({ file: f, url: URL.createObjectURL(f) }))
  useEffect(() => () => previews.forEach(p => URL.revokeObjectURL(p.url)), [previews])

  function addPhotos(list: FileList | null) {
    if (!list) return
    setPhotos(prev => [...prev, ...Array.from(list)].slice(0, MAX_FILES))
    if (fileRef.current) fileRef.current.value = ''
  }

  function reset(keepCustomer: boolean) {
    setTitle(''); setBody(''); setTags([]); setShared(false); setPhotos([]); setAudio(null); setOrderId(''); setError(''); setDone(null)
    if (!keepCustomer) { setCustomer(null); setQuery('') }
  }

  async function submit() {
    if (!customer) { setError('Pick a customer first'); return }
    if (!title.trim() && !body.trim() && photos.length === 0 && !audio) { setError('Add a photo, a recording, or a note'); return }
    setSubmitting(true); setError('')
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
      if (res.status === 401) { router.refresh(); return }
      if (!res.ok) { setError(data.error || 'Failed to save'); return }
      setDone({ warnings: data.warnings || [] })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    await fetch('/api/staff/auth/logout', { method: 'POST' })
    router.refresh()
  }

  if (done) {
    return (
      <main className="max-w-md mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-foreground-secondary mt-2">The note is now on {customer?.name}&apos;s profile{shared ? ' and shared with them' : ''}.</p>
        {done.warnings.length > 0 && (
          <ul className="mt-3 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4 space-y-1">{done.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}
        <div className="mt-8 space-y-3">
          <button type="button" onClick={() => reset(true)} className="w-full py-3 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold">Add another for {customer?.name}</button>
          <button type="button" onClick={() => reset(false)} className="w-full py-3 rounded-xl border border-border-secondary font-semibold">New customer</button>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-md mx-auto px-4 py-6 pb-28">
      {scanning && <StaffQrScanner onResult={(text) => { setScanning(false); setCustomer(null); setQuery(text) }} onClose={() => setScanning(false)} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">{storeName}</p>
          <h1 className="text-2xl font-bold mt-1">Customer note</h1>
        </div>
        <button type="button" onClick={logout} className="text-xs text-foreground-muted hover:underline mt-1">Sign out</button>
      </div>
      <p className="text-xs text-foreground-muted mt-1">Signed in as {staff.name || staff.email}</p>

      <section className="mt-6">
        <label className="block text-sm font-medium mb-1.5">Customer</label>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-accent-500 bg-accent-500/5 p-3">
            <div className="min-w-0">
              <p className="font-semibold truncate">{customer.name}</p>
              <p className="text-xs text-foreground-muted truncate">{[customer.phone, customer.email].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" onClick={() => { setCustomer(null); setQuery('') }} className="text-xs text-accent-600 hover:underline shrink-0">Change</button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, phone, email or order number" className={inputClass} autoFocus />
              <button type="button" onClick={() => setScanning(true)} className="px-3 rounded-xl border border-border-secondary text-xs font-medium shrink-0">Scan</button>
            </div>
            {(results.length > 0 || searching) && (
              <ul className="mt-2 rounded-xl border border-border-default divide-y divide-border-default overflow-hidden">
                {searching && results.length === 0 && <li className="px-3 py-2 text-xs text-foreground-muted">Searching…</li>}
                {results.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => { setCustomer(c); setResults([]) }} className="w-full text-left px-3 py-2.5 hover:bg-surface-secondary">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-foreground-muted">{[c.phone, c.email, c.lastOrderNumber ? `Last order ${c.lastOrderNumber}` : null].filter(Boolean).join(' · ')}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {customer && orders.length > 0 && (
        <section className="mt-5">
          <label className="block text-sm font-medium mb-1.5">Link to an order <span className="text-foreground-muted font-normal">(optional)</span></label>
          <select value={orderId} onChange={e => setOrderId(e.target.value)} className={inputClass}>
            <option value="">No specific order</option>
            {orders.map(o => (
              <option key={o.id} value={o.id}>{o.orderNumber} · {o.status.replace(/_/g, ' ')} · Rs. {o.total.toLocaleString('en-IN')}{o.returnRequestId ? ' · has return' : ''}</option>
            ))}
          </select>
        </section>
      )}

      <section className="mt-5">
        <label className="block text-sm font-medium mb-1.5">Photos</label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-center py-4 rounded-xl border-2 border-dashed border-border-secondary text-sm font-medium cursor-pointer hover:bg-surface-secondary">
            Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
          </label>
          <label className="flex items-center justify-center py-4 rounded-xl border-2 border-dashed border-border-secondary text-sm font-medium cursor-pointer hover:bg-surface-secondary">
            Choose from gallery
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addPhotos(e.target.files)} />
          </label>
        </div>
        {previews.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {previews.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border-default">
                <img src={p.url} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs">x</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-foreground-muted mt-1">Up to {MAX_FILES} attachments. Handwritten notes, sketches, measurements.</p>
      </section>

      <section className="mt-5">
        <StaffVoiceMemo onRecorded={(blob, duration) => setAudio(blob ? { blob, duration } : null)} />
      </section>

      <section className="mt-5 space-y-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" className={inputClass} maxLength={200} />
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Typed note (optional)" className={inputClass} maxLength={4000} />
        <div className="flex flex-wrap gap-2">
          {NOTE_TAGS.map(t => (
            <button key={t} type="button" onClick={() => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${tags.includes(t) ? 'bg-accent-500 text-white border-accent-500' : 'bg-surface border-border-secondary text-foreground-secondary'}`}>
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-border-default p-3 text-sm">
          <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="w-5 h-5 rounded" />
          <span>Share with the customer <span className="block text-[11px] text-foreground-muted">Shows on their order page. Leave off for internal notes.</span></span>
        </label>
      </section>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface/95 backdrop-blur border-t border-border-default">
        <div className="max-w-md mx-auto">
          <button type="button" onClick={submit} disabled={submitting || !customer} className="w-full py-3.5 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold text-base disabled:opacity-50">
            {submitting ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </main>
  )
}
