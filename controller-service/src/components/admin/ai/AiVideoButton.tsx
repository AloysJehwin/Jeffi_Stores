'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, Video, X } from 'lucide-react'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import Select from '@/components/ui/Select'
import { ap } from '@/lib/shared/admin-path'
import { AI_VIDEO_DURATIONS, type AiVideoAspect } from '@/lib/ai/media-features'

interface Props {
  feature: 'social_video'
  defaultPrompt?: string
  defaultImageUrl?: string
  defaultAspect?: AiVideoAspect
  scope?: string
  onPick: (videoUrl: string) => void
  compact?: boolean
  label?: string
}

export default function AiVideoButton({ feature, defaultPrompt = '', defaultImageUrl, defaultAspect = '9:16', scope = 'social', onPick, compact, label }: Props) {
  const canWrite = useCanWrite(scope)
  const canUseAi = useCanUseAi(scope)
  const [open, setOpen] = useState(false)
  if (!canWrite || !canUseAi) return null
  const btnCls = compact
    ? 'inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700'
    : 'inline-flex h-control items-center gap-1.5 rounded-lg border border-border-default px-3 text-xs font-semibold text-foreground hover:bg-surface-secondary'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnCls}>
        <Video className="w-3.5 h-3.5" />
        {label || 'AI video'}
      </button>
      {open && <Dialog feature={feature} defaultPrompt={defaultPrompt} defaultImageUrl={defaultImageUrl} defaultAspect={defaultAspect} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  )
}

function Dialog({
  feature,
  defaultPrompt,
  defaultImageUrl,
  defaultAspect,
  onPick,
  onClose,
}: {
  feature: 'social_video'
  defaultPrompt?: string
  defaultImageUrl?: string
  defaultAspect: AiVideoAspect
  onPick: (videoUrl: string) => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [prompt, setPrompt] = useState(defaultPrompt ?? '')
  const [imageUrl, setImageUrl] = useState(defaultImageUrl ?? '')
  const [aspect, setAspect] = useState<AiVideoAspect>(defaultAspect)
  const [durationSec, setDurationSec] = useState<number>(4)
  const [starting, setStarting] = useState(false)
  const [progress, setProgress] = useState<'queued' | 'running' | 'done' | 'failed' | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletNotice, setWalletNotice] = useState<{ balanceInr: number; neededInr: number } | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [perSecond, setPerSecond] = useState<number | null>(null)
  const [charged, setCharged] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/ai/price?feature=${feature}`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => !cancelled && setPerSecond(typeof j.priceInr === 'number' ? j.priceInr : null))
      .catch(() => !cancelled && setPerSecond(null))
    return () => {
      cancelled = true
    }
  }, [feature])

  async function start() {
    if (prompt.trim().length < 3) {
      setError('Describe the scene (a sentence works).')
      return
    }
    setStarting(true)
    setError(null)
    setWalletNotice(null)
    try {
      const res = await fetch('/api/admin/ai/video', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, prompt: prompt.trim(), imageUrl: imageUrl.trim() || undefined, aspect, durationSec }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 402) {
        setWalletNotice({ balanceInr: j.balanceInr ?? 0, neededInr: j.neededInr ?? 0 })
        return
      }
      if (!res.ok) throw new Error(j.error || 'Video start failed')
      setPrice(typeof j.estimatedPriceInr === 'number' ? j.estimatedPriceInr : null)
      setProgress('queued')
      poll(j.jobId as string, j.usageId as string | undefined)
    } catch (e) {
      setError((e as Error).message || 'Video start failed')
    } finally {
      setStarting(false)
    }
  }

  function poll(jobId: string, usageId?: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const url = `/api/admin/ai/video/${encodeURIComponent(jobId)}${usageId ? `?usageId=${encodeURIComponent(usageId)}` : ''}`
        const r = await fetch(url, { credentials: 'include' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Video poll failed')
        setProgress(j.status)
        if (j.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current)
          setVideoUrl(j.videoUrl)
          if (typeof j.priceInr === 'number') setCharged(j.priceInr)
        } else if (j.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
          setError(j.error || 'Video generation failed')
        }
      } catch (e) {
        if (pollRef.current) clearInterval(pollRef.current)
        setError((e as Error).message || 'Video poll failed')
      }
    }, 6000)
  }

  function use() {
    if (!videoUrl) return
    onPick(videoUrl)
    showToast('Video added', 'success')
    onClose()
  }

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="AI video">
      <div className="w-full max-w-2xl rounded-xl bg-surface-primary border border-border-default shadow-xl">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Video className="w-4 h-4 text-accent-500" /> Generate video
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-surface-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-secondary">Describe the shot</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border-default bg-surface-primary px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-secondary">From this image (optional)</label>
            <input
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="h-control w-full rounded-lg border border-border-default bg-surface-primary px-3 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Aspect</label>
              <Select<AiVideoAspect>
                className="w-full"
                aria-label="Aspect"
                value={aspect}
                onChange={setAspect}
                options={[
                  { value: '9:16', label: '9:16 (vertical)' },
                  { value: '16:9', label: '16:9 (wide)' },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Duration (s)</label>
              <Select className="w-full" aria-label="Duration (s)" value={durationSec} onChange={setDurationSec} options={AI_VIDEO_DURATIONS.map(d => ({ value: d, label: String(d) }))} />
            </div>
          </div>
          {perSecond != null && !progress && (
            <p className="text-xs text-foreground-muted" data-testid="ai-price">
              {perSecond > 0 ? `About ₹${(perSecond * durationSec).toFixed(2)} for ${durationSec}s, charged to your wallet.` : 'No charge.'}
            </p>
          )}
          {walletNotice && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              Wallet balance ₹{walletNotice.balanceInr.toFixed(2)} is below the ₹{walletNotice.neededInr.toFixed(2)} needed.{' '}
              <a href={ap('/admin/wallet')} className="underline">Top up</a>.
            </div>
          )}
          {progress && progress !== 'done' && progress !== 'failed' && (
            <p className="flex items-center gap-2 text-xs text-foreground-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {progress === 'queued' ? 'Queued…' : 'Rendering…'}
              {price != null ? ` About ₹${price.toFixed(2)}.` : ''}
            </p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {videoUrl && (
            <video src={videoUrl} controls className="aspect-video w-full rounded-lg border border-border-default" />
          )}
          {videoUrl && (charged ?? price) != null && (
            <p className="text-xs text-foreground-muted" data-testid="ai-charge">
              {(charged ?? price)! > 0 ? `Charged ₹${(charged ?? price)!.toFixed(2)} to your wallet.` : 'No charge.'}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-default px-4 py-3">
          <button type="button" onClick={onClose} className="h-control rounded-lg border border-border-default px-3 text-xs font-semibold hover:bg-surface-secondary">
            Close
          </button>
          {videoUrl ? (
            <button type="button" onClick={use} className="h-control rounded-lg bg-accent-500 px-3 text-xs font-semibold text-white hover:bg-accent-600">
              Use this
            </button>
          ) : (
            <button type="button" onClick={start} disabled={starting || !!progress} className="inline-flex h-control items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
              {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {starting ? 'Starting…' : 'Generate'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
