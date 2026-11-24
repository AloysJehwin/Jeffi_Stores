'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Monitor, Smartphone } from 'lucide-react'
import { Segmented } from '../../_ui'
import { previewSrc } from './api'

// The site preview in the wizard: the studio's preview route in an iframe, laid out at a real desktop or phone width
// and scaled to fit. Same origin, so the frame and the wizard talk by postMessage (studio-preview): the frame reports
// when it is ready and which section the owner clicked; the wizard turns section picking on and off.

export type Device = 'desktop' | 'phone'
export interface PickedSection {
  page: string
  blockId: string
  label: string
}

const WIDTH: Record<Device, number> = { desktop: 1280, phone: 390 }
const PHONE_H = 780
const PHONE_SCREEN = '(max-width: 639px)'

/** Phone below 640px, Desktop above; follows the window (a resize, a turned phone) until the owner picks one. */
export function usePreviewDevice(): [Device, (d: Device) => void] {
  const [device, setDevice] = useState<Device>(() => (typeof window !== 'undefined' && window.matchMedia(PHONE_SCREEN).matches ? 'phone' : 'desktop'))
  const chosen = useRef(false)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_SCREEN)
    const follow = () => {
      if (!chosen.current) setDevice(mq.matches ? 'phone' : 'desktop')
    }
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [])
  const choose = useCallback((d: Device) => {
    chosen.current = true
    setDevice(d)
  }, [])
  return [device, choose]
}

export function DeviceToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <Segmented<Device>
      ariaLabel="Preview size"
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: 'desktop', label: 'Desktop', icon: Monitor },
        { value: 'phone', label: 'Phone', icon: Smartphone },
      ]}
    />
  )
}

export default function StudioPreview({
  sessionId,
  page,
  device,
  version,
  picking = false,
  picked,
  onPick,
  onOpenPage,
  overlay,
  query,
}: {
  sessionId: string
  page: string
  device: Device
  /** Bump to reload the frame after the page changed. */
  version: number
  picking?: boolean
  picked?: PickedSection | null
  onPick?: (s: PickedSection) => void
  /** A link in the preview pointed at another page of the site. */
  onOpenPage?: (key: string) => void
  /** Shown over the frame (a change being made). */
  overlay?: React.ReactNode
  /** More for the preview route's query (a theme tried before it is applied). */
  query?: Record<string, string>
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(0)
  const [ready, setReady] = useState(false)
  const src = previewSrc(sessionId, page, device, version, query)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => setReady(false), [src])

  const post = (msg: object) => frame.current?.contentWindow?.postMessage({ type: 'studio-preview', ...msg }, window.location.origin)
  useEffect(() => {
    if (ready) post({ picking, picked: picked?.page === page ? picked.blockId : null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, picking, picked, page])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return
      const d = e.data
      if (!d || d.type !== 'studio-preview') return
      if (d.event === 'ready') setReady(true)
      else if (d.event === 'pick' && typeof d.blockId === 'string') onPick?.({ page: String(d.page), blockId: d.blockId, label: String(d.label || 'Section') })
      else if (d.event === 'open' && typeof d.page === 'string') onOpenPage?.(d.page)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onPick, onOpenPage])

  const w = WIDTH[device]
  const phone = device === 'phone'
  const avail = Math.max(0, width - (phone ? 24 : 0))
  const scale = avail ? Math.min(1, avail / w) : 1
  // Desktop shows a window onto the page; the phone shows the whole screen.
  const visibleH = phone ? Math.round(PHONE_H * scale) : Math.round(Math.min(680, Math.max(420, avail * 0.62)))
  const frameH = phone ? PHONE_H : Math.round(visibleH / scale)

  return (
    <div ref={box} className="w-full">
      <div className={phone ? 'mx-auto rounded-[2.4rem] border-[10px] border-[#1b1714] bg-[#1b1714] shadow-xl' : 'overflow-hidden rounded-2xl border border-border-default bg-white shadow-sm'} style={phone ? { width: Math.round(w * scale) + 20 } : undefined}>
        {!phone && (
          <div className="flex items-center gap-1.5 border-b border-border-default bg-surface-secondary/60 px-3 py-2" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#e3dacb]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e3dacb]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e3dacb]" />
          </div>
        )}
        <div className={`relative overflow-hidden bg-white ${phone ? 'rounded-[1.8rem]' : ''}`} style={{ height: visibleH }}>
          {width > 0 && (
            <iframe
              ref={frame}
              key={src}
              src={src}
              title="Preview of your site"
              className="absolute left-0 top-0 origin-top-left border-0 bg-white"
              style={{ width: w, height: frameH, transform: `scale(${scale})` }}
            />
          )}
          {(!ready || overlay) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
              {overlay ?? (
                <span className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
