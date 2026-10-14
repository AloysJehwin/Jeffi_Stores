'use client'

import { useEffect } from 'react'

// A focused <input type="number"> natively increments on wheel/trackpad scroll, so scrolling
// the page over one silently edits its value. Blur the input instead and let the scroll through,
// which leaves keyboard arrows as the only step control.
export default function NumberInputWheelGuard() {
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      const el = e.target as HTMLElement | null
      if (!el || el !== document.activeElement) return
      if (el.tagName !== 'INPUT') return
      if ((el as HTMLInputElement).type !== 'number') return
      el.blur()
    }

    document.addEventListener('wheel', onWheel, { passive: true })
    return () => document.removeEventListener('wheel', onWheel)
  }, [])

  return null
}
