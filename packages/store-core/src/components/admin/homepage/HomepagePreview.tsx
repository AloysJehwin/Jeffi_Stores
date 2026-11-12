'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Eye, Laptop, Maximize2, Minimize2, Monitor, RefreshCw, RotateCw, Scan, Smartphone, Tablet, TabletSmartphone, X } from 'lucide-react'
import { businessHostForHost, storeHostForHost } from '@/lib/tenancy/forms-host'
import type { HomepageAudience, HomepageSurface } from '@/lib/catalog/homepage-sections'
import { HOMEPAGE_DRAFT_CHANGED } from './draft-events'

// The real homepage (storefront or business app) in an iframe, rendering the draft through a signed
// `?preview=` token. Reloads after every autosave; the device bar picks the size and, with it, the
// surface the store serves (phone / tablet widths get the mobile web layout, "App" the app's sections).

type DeviceId = 'desktop' | 'laptop' | 'tablet' | 'phone' | 'app'

interface Device {
  id: DeviceId
  label: string
  w: number
  h: number
  layout: 'desktop' | 'mobile' | 'app'
  icon: typeof Monitor
}

const DEVICES: Device[] = [
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900, layout: 'desktop', icon: Monitor },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800, layout: 'desktop', icon: Laptop },
  { id: 'tablet', label: 'Tablet', w: 768, h: 1024, layout: 'mobile', icon: Tablet },
  { id: 'phone', label: 'Phone', w: 390, h: 844, layout: 'mobile', icon: Smartphone },
  { id: 'app', label: 'App', w: 390, h: 844, layout: 'app', icon: TabletSmartphone },
]

const localSlug = (host: string): string | null => {
  if (host === 'localhost') return null
  const label = host.slice(0, -'.localhost'.length)
  const m = label.match(/^(?:(?:admin|invoice|quotation|purchaseorder|forms|vault|www)-)?(.+?)(?:\.business)?$/)
  return m && m[1] !== 'admin' && m[1] !== 'business' ? m[1] : null
}

/** The page's URL on the store's (or business portal's) own host, which is a different Next app. */
export function homepagePreviewUrl(audience: HomepageAudience, token: string, layout: Device['layout']): string {
  const { hostname, port } = window.location
  const host = hostname.toLowerCase()
  const q = `?preview=${encodeURIComponent(token)}&layout=${layout}`
  if (host === 'localhost' || host.endsWith('.localhost')) {
    const slug = localSlug(host)
    const base = `http://${slug ? `${slug}.` : ''}localhost${port ? `:${port}` : ''}`
    return `${base}${audience === 'business' ? '/business' : '/'}${q}`
  }
  return audience === 'business' ? `https://${businessHostForHost(host)}/${q}` : `https://${storeHostForHost(host)}/${q}`
}

const DEVICE_FOR: Record<HomepageSurface, DeviceId> = { web: 'desktop', web_mobile: 'phone', app: 'app' }

export default function HomepagePreviewButton({ token, audience, surface = 'web' }: { token: string; audience: HomepageAudience; surface?: HomepageSurface }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="control-sm inline-flex items-center gap-1.5 rounded-md border border-border-secondary bg-surface text-xs font-medium text-foreground hover:bg-surface-secondary"
      >
        <Eye className="w-3.5 h-3.5" /> Preview
      </button>
      {open && <HomepagePreviewModal token={token} audience={audience} surface={surface} onClose={() => setOpen(false)} />}
    </>
  )
}

function HomepagePreviewModal({ token, audience, surface, onClose }: { token: string; audience: HomepageAudience; surface: HomepageSurface; onClose: () => void }) {
  // Opens on the device the editor's selector highlights.
  const [device, setDevice] = useState<Device>(() => DEVICES.find(d => d.id === DEVICE_FOR[surface]) ?? DEVICES[0])
  const [landscape, setLandscape] = useState(false)
  const [fit, setFit] = useState(true)
  const [full, setFull] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(true)
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  const stage = useRef<HTMLDivElement>(null)

  const w = landscape ? device.h : device.w
  const h = landscape ? device.w : device.h
  const scale = fit && avail.w && avail.h ? Math.min(1, (avail.w - 32) / w, (avail.h - 32) / h) : 1
  const url = homepagePreviewUrl(audience, token, device.layout)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setAvail({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [full])

  // Every autosave bumps the iframe key; edits arrive in bursts, so wait for them to settle.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setReloads(n => n + 1), 700)
    }
    window.addEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
    return () => {
      window.removeEventListener(HOMEPAGE_DRAFT_CHANGED, onChange)
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => setLoading(true), [url, reloads])

  const Tab = ({ d }: { d: Device }) => {
    const Icon = d.icon
    const on = d.id === device.id
    return (
      <button
        type="button"
        onClick={() => setDevice(d)}
        aria-pressed={on}
        title={`${d.label} · ${d.w}×${d.h}`}
        className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium ${on ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{d.label}</span>
      </button>
    )
  }

  const Icon = ({ on, label, icon: I, onClick }: { on?: boolean; label: string; icon: typeof Monitor; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${on ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
    >
      <I className="w-4 h-4" />
    </button>
  )

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Homepage preview" className={`fixed z-[1000] flex flex-col bg-surface shadow-2xl ${full ? 'inset-0' : 'inset-3 sm:inset-6 rounded-2xl border border-border-default overflow-hidden'}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-default bg-surface-elevated">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-border-default bg-surface">
          {DEVICES.map(d => (
            <Tab key={d.id} d={d} />
          ))}
        </div>
        <span className="text-xs tabular-nums text-foreground-muted">
          {w}×{h}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        {device.id === 'app' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Approximate: the app&apos;s sections drawn by the web renderer
          </span>
        )}
        {audience === 'business' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-foreground-muted">Business homepage</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Icon label="Rotate" icon={RotateCw} on={landscape} onClick={() => setLandscape(l => !l)} />
          <Icon label={fit ? 'Actual size' : 'Zoom to fit'} icon={Scan} on={fit} onClick={() => setFit(f => !f)} />
          <Icon label="Reload" icon={RefreshCw} onClick={() => setReloads(n => n + 1)} />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-secondary"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <Icon label={full ? 'Exit full screen' : 'Full screen'} icon={full ? Minimize2 : Maximize2} on={full} onClick={() => setFull(f => !f)} />
          <Icon label="Close" icon={X} onClick={onClose} />
        </div>
      </div>
      <div ref={stage} className="relative flex-1 min-h-0 overflow-auto bg-surface-secondary/60">
        <div className="min-w-full min-h-full flex items-start justify-center p-4">
          <div style={{ width: w * scale, height: h * scale }} className="relative shrink-0">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-foreground-muted">Loading preview…</div>
            )}
            <iframe
              key={`${device.id}:${reloads}`}
              src={url}
              title="Homepage preview"
              onLoad={() => setLoading(false)}
              style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
              className="absolute top-0 left-0 bg-white border border-border-default rounded-lg shadow-lg"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
