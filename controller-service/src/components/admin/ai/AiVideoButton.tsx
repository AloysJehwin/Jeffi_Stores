'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Video } from 'lucide-react'
import { Dialog } from '@/components/admin/kit'
import GalleryPicker from '@/components/admin/GalleryPicker'
import PresetChipRow from './PresetChipRow'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import Select from '@/components/ui/Select'
import { ap } from '@/lib/shared/admin-path'
import { AI_VIDEO_DURATIONS, type AiVideoAspect, type AiVideoFeature } from '@/lib/ai/media-features'

export interface AiVideoPick {
  url: string
  galleryVideoId?: string | null
  durationSec?: number | null
  /** The image the video started from (the gallery poster), when there was one. */
  posterUrl?: string | null
}

interface Props {
  feature?: AiVideoFeature
  /** Area whose :write scope gates the button; defaults from the feature. */
  scope?: string
  defaultPrompt?: string
  /** Image-to-video source; `referenceImageUrl` wins over `defaultImageUrl`. */
  defaultImageUrl?: string
  referenceImageUrl?: string
  defaultAspect?: AiVideoAspect
  onPick: (video: AiVideoPick) => void
  /** Logged on the usage row (slide id, offer id). */
  usageRef?: string
  compact?: boolean
  label?: string
}

const SCOPE_BY_FEATURE: Record<AiVideoFeature, string> = {
  social_video: 'social',
  homepage_video: 'settings',
  offer_video: 'coupons',
}

const ASPECT_OPTIONS: { value: AiVideoAspect; label: string }[] = [
  { value: '9:16', label: '9:16 (vertical)' },
  { value: '16:9', label: '16:9 (wide)' },
  { value: '1:1', label: '1:1 (square)' },
]

export default function AiVideoButton({
  feature = 'social_video',
  scope,
  defaultPrompt = '',
  defaultImageUrl,
  referenceImageUrl,
  defaultAspect = '9:16',
  onPick,
  usageRef,
  compact,
  label,
}: Props) {
  const area = scope ?? SCOPE_BY_FEATURE[feature]
  const canWrite = useCanWrite(area)
  const canUseAi = useCanUseAi(area)
  const [open, setOpen] = useState(false)
  if (!canWrite || !canUseAi) return null
  const btnCls = compact
    ? 'inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700'
    : 'control-md inline-flex items-center gap-1.5 border border-border-default text-xs font-semibold text-foreground hover:bg-surface-secondary'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnCls}>
        <Video className="w-3.5 h-3.5" />
        {label || 'AI video'}
      </button>
      {open && (
        <VideoDialog
          feature={feature}
          defaultPrompt={defaultPrompt}
          defaultImageUrl={referenceImageUrl ?? defaultImageUrl}
          defaultAspect={defaultAspect}
          usageRef={usageRef}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function VideoDialog({
  feature,
  defaultPrompt,
  defaultImageUrl,
  defaultAspect,
  usageRef,
  onPick,
  onClose,
}: {
  feature: AiVideoFeature
  defaultPrompt?: string
  defaultImageUrl?: string
  defaultAspect: AiVideoAspect
  usageRef?: string
  onPick: (video: AiVideoPick) => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [prompt, setPrompt] = useState(defaultPrompt ?? '')
  const [imageUrl, setImageUrl] = useState(defaultImageUrl ?? '')
  const [aspect, setAspect] = useState<AiVideoAspect>(defaultAspect)
  const [durationSec, setDurationSec] = useState<number>(4)
  const [uploading, setUploading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [progress, setProgress] = useState<'queued' | 'running' | 'done' | 'failed' | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [done, setDone] = useState<Omit<AiVideoPick, 'url'>>({})
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

  async function uploadToGallery() {
    const u = imageUrl.trim()
    if (!u) return
    setUploading(true)
    setError(null)
    try {
      const res = await fetch('/api/gallery/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: u }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Upload failed')
      if (typeof j.image_url === 'string') setImageUrl(j.image_url)
      showToast('Added to Gallery', 'success')
    } catch (e) {
      setError((e as Error).message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

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
        body: JSON.stringify({ feature, prompt: prompt.trim(), imageUrl: imageUrl.trim() || undefined, aspect, durationSec, ref: usageRef }),
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
        const qs = new URLSearchParams({ feature })
        if (usageId) qs.set('usageId', usageId)
        const url = `/api/admin/ai/video/${encodeURIComponent(jobId)}?${qs}`
        const r = await fetch(url, { credentials: 'include' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Video poll failed')
        setProgress(j.status)
        if (j.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current)
          setVideoUrl(j.videoUrl)
          setDone({ galleryVideoId: j.galleryVideoId ?? null, durationSec: j.durationSec ?? null, posterUrl: j.posterUrl ?? (imageUrl.trim() || null) })
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
    onPick({ url: videoUrl, ...done })
    showToast('Video added', 'success')
    onClose()
  }

  const inProgress = !!progress && progress !== 'done' && progress !== 'failed'
  const hasStatus = !!walletNotice || inProgress || !!error || !!videoUrl

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        zIndex="z-[200]"
        title={<span className="flex items-center gap-2"><Video className="h-4 w-4 text-accent-500" />Generate video</span>}
        footer={
          <>
            <button type="button" onClick={onClose} className="control-md border border-border-default text-xs font-semibold hover:bg-surface-secondary">
              Close
            </button>
            {videoUrl ? (
              <button type="button" onClick={use} className="control-md bg-accent-500 text-xs font-semibold text-white hover:bg-accent-600">
                Use this
              </button>
            ) : (
              <button
                type="button"
                onClick={start}
                disabled={starting || inProgress}
                className="control-md bg-accent-500 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {starting ? 'Starting…' : 'Generate'}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <PresetChipRow kind="video" feature={feature} onPick={(next: string) => setPrompt(next)} />
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
            <div className="flex flex-wrap gap-2">
              <input
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="field-md min-w-0 flex-1 border border-border-default bg-surface-primary"
              />
              <button
                type="button"
                onClick={uploadToGallery}
                disabled={uploading || !imageUrl.trim()}
                className="control-md shrink-0 border border-border-default text-xs font-semibold hover:bg-surface-secondary disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Upload'}
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="control-md shrink-0 border border-border-default text-xs font-semibold hover:bg-surface-secondary"
              >
                Pick from Gallery
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Aspect</label>
              <Select<AiVideoAspect>
                className="w-full"
                aria-label="Aspect"
                value={aspect}
                onChange={setAspect}
                options={ASPECT_OPTIONS}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-secondary">Duration (s)</label>
              <Select
                className="w-full"
                aria-label="Duration (s)"
                value={durationSec}
                onChange={setDurationSec}
                options={AI_VIDEO_DURATIONS.map(d => ({ value: d, label: String(d) }))}
              />
            </div>
          </div>
          {perSecond != null && !progress && (
            <p className="text-xs text-foreground-muted" data-testid="ai-price">
              {perSecond > 0 ? `About ₹${(perSecond * durationSec).toFixed(2)} for ${durationSec}s, charged to your wallet.` : 'No charge.'}
            </p>
          )}
          {hasStatus && (
            <div className="space-y-3 border-t-2 border-border-default pt-3">
              {walletNotice && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  Wallet balance ₹{walletNotice.balanceInr.toFixed(2)} is below the ₹{walletNotice.neededInr.toFixed(2)} needed.{' '}
                  <a href={ap('/admin/wallet')} className="underline">Top up</a>.
                </div>
              )}
              {inProgress && (
                <p className="flex items-center gap-2 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress === 'queued' ? 'Queued…' : 'Rendering…'}
                  {price != null ? ` About ₹${price.toFixed(2)}.` : ''}
                </p>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              {videoUrl && (
                <video
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  playsInline
                  className="max-h-[60vh] w-full rounded-lg border border-border-default bg-black"
                />
              )}
              {videoUrl && (charged ?? price) != null && (
                <p className="text-xs text-foreground-muted" data-testid="ai-charge">
                  {(charged ?? price)! > 0 ? `Charged ₹${(charged ?? price)!.toFixed(2)} to your wallet.` : 'No charge.'}
                </p>
              )}
            </div>
          )}
        </div>
      </Dialog>
      {pickerOpen && (
        <GalleryPicker
          mode="single"
          onConfirm={imgs => {
            if (imgs[0]) setImageUrl(imgs[0].image_url)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}
