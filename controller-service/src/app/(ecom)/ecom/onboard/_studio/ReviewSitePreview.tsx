'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { studioGet, type StudioView } from './api'
import StudioPreview, { DeviceToggle, usePreviewDevice } from './StudioPreview'

// The Review step's look at the site the studio built: the preview when it is done, its progress while it builds
// (polled; the build runs on the server whatever step the owner is on), a short note and a way back when it failed.

const POLL_MS = 5000

export default function ReviewSitePreview({ onEdit }: { onEdit: () => void }) {
  const [view, setView] = useState<StudioView | null>(null)
  const [error, setError] = useState(false)
  const [page, setPage] = useState('store:home')
  const [device, setDevice] = usePreviewDevice()
  const [version, setVersion] = useState(0)
  const s = view?.session ?? null
  const building = s?.status === 'building'

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const v = await studioGet()
        if (!alive) return
        setView(v)
        setError(false)
        if (v.session?.status === 'building') {
          setVersion(n => n + 1)
          timer = setTimeout(load, POLL_MS)
        }
      } catch {
        if (!alive) return
        setError(true)
        timer = setTimeout(load, POLL_MS * 3)
      }
    }
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const built = s ? Object.keys(s.pages ?? {}).length : 0
  const planned = (s?.plan?.pages ?? []).filter(p => p.enabled && !p.key.startsWith('store:announcement') && s?.pages?.[p.key])
  const total = (s?.plan?.pages ?? []).filter(p => p.enabled).length
  const homeReady = !!s?.pages?.['store:home']
  const failed = !!s && !building && (s.status === 'failed' || !homeReady)

  let body: React.ReactNode
  if (!view && !error) {
    body = <Note spin>Loading your site…</Note>
  } else if (!s) {
    body = <Note>Your site hasn’t been designed yet. <Back onEdit={onEdit} /></Note>
  } else if (building && !homeReady) {
    body = (
      <Note spin>
        Your site is still being built{total ? ` (${planned.length} of ${total} pages)` : ''}. It will appear here when it’s ready.
      </Note>
    )
  } else if (failed) {
    body = (
      <Note warn>
        Your site didn’t finish building. <Back onEdit={onEdit} label="Go back to Your site" /> to continue it.
      </Note>
    )
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {planned.length > 1 && (
              <select value={page} onChange={e => setPage(e.target.value)} aria-label="Page to preview" className="min-w-0 max-w-full rounded-full border border-border-default bg-surface-elevated px-3 py-1.5 text-sm text-foreground">
                {planned.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            {building && (
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Still building: {planned.length} of {total} pages
              </span>
            )}
          </div>
          <DeviceToggle value={device} onChange={setDevice} />
        </div>
        <StudioPreview sessionId={s.id} page={page} device={device} version={version} />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-4 sm:p-5">
      <div className="mb-3 text-sm font-semibold text-foreground">Your site</div>
      {body}
    </div>
  )
}

function Note({ children, spin, warn }: { children: React.ReactNode; spin?: boolean; warn?: boolean }) {
  return (
    <p className="flex items-start gap-2 text-sm text-foreground-secondary" role="status">
      {spin ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : warn ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Back({ onEdit, label = 'Open Your site' }: { onEdit: () => void; label?: string }) {
  return (
    <button type="button" onClick={onEdit} className="font-semibold text-foreground underline underline-offset-2">
      {label}
    </button>
  )
}
