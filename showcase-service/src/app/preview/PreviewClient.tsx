'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PreviewState } from '@showcase/lib/preview'

// The preview's live part: polls /preview/state every 3s and re-renders the page when its version changes, briefly
// marking the sections that changed. While the site is a draft, a thin bar says this is a preview; once it is live, a
// sticky banner links to the live site and counts down to the link's expiry, then goes there.

export const POLL_MS = 3000
const FLASH_MS = 2400
const MARK = 'data-preview-changed'

export function changedSections(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(after).filter(id => before[id] !== after[id])
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function flash(ids: string[]) {
  for (const id of ids) {
    const el = document.getElementById(id)
    if (!el) continue
    el.setAttribute(MARK, '')
    setTimeout(() => el.removeAttribute(MARK), FLASH_MS)
  }
}

export default function PreviewClient({ token, state: rendered }: { token: string; state: PreviewState }) {
  const router = useRouter()
  const [state, setState] = useState(rendered)
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef(rendered)
  const pending = useRef<string[]>([])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const res = await fetch(`/preview/state?t=${encodeURIComponent(token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
        // Run out or no longer valid: the page itself decides (the live site, or the expired note).
        if (res.status === 404 || res.status === 410) return location.reload()
        if (res.ok) {
          const next = (await res.json()) as PreviewState
          if (next.version !== seen.current.version) {
            pending.current = changedSections(seen.current.sections, next.sections)
            seen.current = next
            router.refresh()
          }
          if (!stopped) setState(next)
        }
      } catch {}
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [token, router])

  // The refreshed page has arrived: mark what changed.
  useEffect(() => {
    const ids = pending.current
    pending.current = []
    if (ids.length) flash(ids)
  }, [rendered.version])

  const left = Date.parse(state.expiresAt) - now
  useEffect(() => {
    if (!state.live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [state.live])
  useEffect(() => {
    if (state.live && left <= 0) location.replace('/')
  }, [state.live, left])

  return (
    <>
      <style>{`[${MARK}]{outline:3px solid #10b981;outline-offset:-3px;transition:outline-color .4s}`}</style>
      {state.live ? (
        <div role="status" aria-live="polite" className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-emerald-700 px-4 py-3 text-center text-sm text-white shadow-md">
          <span className="font-semibold">Your site is live</span>
          <a href="/" className="rounded-full bg-white px-4 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-50">
            Go to your live site
          </a>
          <span className="tabular-nums text-white/85">This preview closes in {countdown(left)}</span>
        </div>
      ) : (
        <div role="status" className="sticky top-0 z-[60] bg-neutral-900 px-4 py-2 text-center text-xs text-white/90">
          Preview of your site. It updates here as changes are made.
        </div>
      )}
    </>
  )
}
