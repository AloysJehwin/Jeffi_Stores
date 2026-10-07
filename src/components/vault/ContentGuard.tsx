'use client'

import { useEffect, useState } from 'react'
import Watermark, { type WatermarkInfo } from './Watermark'

// Deterrence, NOT DRM: blocks casual copy paths, hides on blur/print, overlays an identity watermark.

const BLOCKED_KEYS = new Set(['s', 'p', 'c', 'a', 'u']) // Ctrl/Cmd + these

export default function ContentGuard({
  watermark,
  children,
}: {
  watermark: WatermarkInfo
  children: React.ReactNode
}) {
  const [obscured, setObscured] = useState(false)

  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    const events: (keyof DocumentEventMap)[] = [
      'selectstart', 'copy', 'cut', 'paste', 'contextmenu', 'dragstart',
    ]
    events.forEach(ev => document.addEventListener(ev, stop))

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setObscured(true)
        navigator.clipboard?.writeText('').catch(() => {})
        window.setTimeout(() => setObscured(false), 1200)
        return
      }
      if ((e.ctrlKey || e.metaKey) && BLOCKED_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey, true)
    // Windows often only fires PrintScreen on keyup.
    document.addEventListener('keyup', onKey, true)

    const onBlur = () => setObscured(true)
    const onFocus = () => setObscured(false)
    const onVis = () => setObscured(document.visibilityState === 'hidden')
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      events.forEach(ev => document.removeEventListener(ev, stop))
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return (
    <div>
      <style>{`@media print { .vault-protected { display: none !important; } body::after { content: 'Printing is disabled for protected content.'; } }`}</style>
      <div
        className="vault-protected relative select-none"
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={e => e.preventDefault()}
      >
        <Watermark info={watermark} />
        <div style={{ filter: obscured ? 'blur(24px)' : undefined, transition: 'filter 120ms' }}>
          {children}
        </div>
        {obscured ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-950/80 text-sm text-neutral-300">
            Content hidden
          </div>
        ) : null}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-neutral-500">
        This content is watermarked with your identity and protected against casual copying. A browser
        cannot prevent operating-system screenshots, photos taken with another device, external screen
        recorders, or developer tools reading a short-lived link. Sharing or redistributing this content
        violates its licence.
      </p>
    </div>
  )
}
