'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'

/** Drag (or swipe) across the frames of a 360° set; arrow keys step one frame. */
export default function SpinViewer({ frames, alt, className = 'h-full w-full' }: { frames: string[]; alt?: string | null; className?: string }) {
  const [i, setI] = useState(0)
  const [hint, setHint] = useState(true)
  const drag = useRef<{ x: number; start: number } | null>(null)
  const n = frames.length

  // Warm the cache so the first drag is smooth.
  useEffect(() => {
    for (const f of frames.slice(0, 72)) {
      const img = new Image()
      img.src = f
    }
  }, [frames])

  if (n === 0) return null
  const step = (d: number) => setI(x => (((x + d) % n) + n) % n)

  return (
    <div
      className={`relative select-none touch-pan-y cursor-grab active:cursor-grabbing ${className}`}
      tabIndex={0}
      role="img"
      aria-label={`${alt || 'Product'}: 360° view, drag to rotate`}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') step(-1)
        if (e.key === 'ArrowRight') step(1)
      }}
      onPointerDown={e => {
        drag.current = { x: e.clientX, start: i }
        setHint(false)
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={e => {
        if (!drag.current) return
        const w = (e.currentTarget as HTMLElement).clientWidth || 300
        const d = Math.round(((e.clientX - drag.current.x) / w) * n)
        setI((((drag.current.start - d) % n) + n) % n)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frames[i]} alt={alt ?? ''} draggable={false} className="h-full w-full object-contain pointer-events-none" />
      {hint && (
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
          <RotateCw className="h-3.5 w-3.5" /> Drag to rotate
        </span>
      )}
    </div>
  )
}
