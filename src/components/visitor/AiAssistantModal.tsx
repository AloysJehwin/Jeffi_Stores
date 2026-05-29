'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

interface ProductCandidate {
  id: string
  name: string
  slug: string
  sku: string
  base_price: string
  brand_name: string | null
  category_name: string | null
  short_description: string | null
  inventory_quantity: number
  primary_image_url: string | null
}

interface Recommendation {
  product: ProductCandidate
  quantity: number
  reason: string
}

interface AssistantResponse {
  summary: string
  recommendations: Recommendation[]
  quota?: { used: number; remaining: number }
  error?: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

const SAMPLE_PROMPTS = [
  'I\'m building a wooden table — what fasteners do I need?',
  'Setting up shelving in my workshop, need brackets and bolts',
  'Need stainless screws for outdoor use',
  'Putting together a 6×4 ft platform — what hardware?',
]

export default function AiAssistantModal({ isOpen, onClose }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AssistantResponse | null>(null)
  const [quota, setQuota] = useState<{ used: number; remaining: number } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    fetch('/api/ai-assistant/recommend', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.quota) setQuota(d.quota) })
      .catch(() => {})
    return () => clearTimeout(t)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setResult(null)
      setLoading(false)
    }
  }, [isOpen])

  async function submit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const q = query.trim()
    if (q.length < 5 || loading) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/ai-assistant/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: q }),
      })
      const data: AssistantResponse = await res.json()
      if (!res.ok) {
        setResult({ summary: '', recommendations: [], error: data.error || 'Something went wrong' })
      } else {
        setResult(data)
        if (data.quota) setQuota(data.quota)
      }
    } catch {
      setResult({ summary: '', recommendations: [], error: 'Network error. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-30 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={overlayRef}
        className={`fixed left-1/2 -translate-x-1/2 top-3 sm:top-3 lg:top-5 z-50 w-[min(720px,calc(100vw-2rem))] transition-all duration-300 ease-out ${
          isOpen
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="bg-surface-elevated rounded-2xl border border-border-default shadow-2xl overflow-hidden">
          <form onSubmit={submit} className="p-3 border-b border-border-default">
            <div className="flex items-start gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <textarea
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  placeholder="Tell me about your project — e.g. I'm building a wooden table, what fasteners do I need?"
                  rows={2}
                  maxLength={500}
                  disabled={loading}
                  className="w-full text-sm bg-transparent text-foreground placeholder:text-foreground-muted focus:outline-none resize-none"
                />
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 pl-11">
              <p className="text-[10px] text-foreground-muted">
                {quota ? `${quota.remaining}/10 queries left today` : 'Press Enter to ask'}
              </p>
              <button
                type="submit"
                disabled={loading || query.trim().length < 5}
                className="px-4 py-1.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Thinking…' : 'Ask AI'}
              </button>
            </div>
          </form>

          <div className="max-h-[min(640px,calc(100vh-9rem))] overflow-y-auto">
            {!loading && !result && (
              <div className="p-5">
                <p className="text-xs text-foreground-muted uppercase tracking-widest font-semibold mb-3">Try one of these</p>
                <div className="space-y-2">
                  {SAMPLE_PROMPTS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setQuery(p); inputRef.current?.focus() }}
                      className="w-full text-left text-sm px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary text-foreground-secondary transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm text-foreground-secondary">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <span>Searching the catalog and picking the right products…</span>
                </div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse" style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="w-16 h-16 rounded-lg bg-surface-secondary shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-3/4 bg-surface-secondary rounded" />
                      <div className="h-3 w-1/2 bg-surface-secondary rounded" />
                      <div className="h-3 w-2/3 bg-surface-secondary rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result?.error && (
              <div className="p-5">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-700 dark:text-red-300">
                  {result.error}
                </div>
              </div>
            )}

            {result && !result.error && (
              <div className="p-4 space-y-4">
                {result.summary && (
                  <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800/50 rounded-lg p-3.5">
                    <p className="text-sm text-foreground leading-relaxed">{result.summary}</p>
                  </div>
                )}

                {result.recommendations.length === 0 ? (
                  <p className="text-sm text-foreground-muted italic text-center py-6">No matching products found. Try different keywords.</p>
                ) : (
                  <div className="space-y-2.5">
                    {result.recommendations.map(rec => {
                      const price = parseFloat(rec.product.base_price)
                      return (
                        <div
                          key={rec.product.id}
                          className="flex gap-3 p-3 border border-border-default rounded-lg hover:border-accent-500 hover:bg-surface-secondary/40 transition-colors"
                        >
                          <Link href={`/products/${rec.product.slug}`} onClick={onClose} className="shrink-0">
                            {rec.product.primary_image_url ? (
                              <Image
                                src={rec.product.primary_image_url}
                                alt={rec.product.name}
                                width={64}
                                height={64}
                                className="w-16 h-16 rounded-lg object-cover bg-surface-secondary"
                                unoptimized
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-surface-secondary" />
                            )}
                          </Link>
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/products/${rec.product.slug}`}
                              onClick={onClose}
                              className="block text-sm font-medium text-foreground hover:text-accent-500 line-clamp-2"
                            >
                              {rec.product.name}
                            </Link>
                            <p className="text-xs text-foreground-muted mt-0.5">
                              {rec.product.brand_name && <span>{rec.product.brand_name} · </span>}
                              ₹{Math.round(price).toLocaleString('en-IN')}
                            </p>
                            <p className="text-xs text-foreground-secondary mt-1.5 line-clamp-2">{rec.reason}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className="px-2 py-0.5 bg-accent-500/10 text-accent-600 dark:text-accent-400 text-xs font-bold rounded">
                              × {rec.quantity}
                            </span>
                            <Link
                              href={`/products/${rec.product.slug}`}
                              onClick={onClose}
                              className="px-3 py-1.5 bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold rounded-lg transition-all active:scale-95 whitespace-nowrap inline-flex items-center gap-1"
                            >
                              View
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
