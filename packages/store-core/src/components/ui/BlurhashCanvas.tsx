'use client'

import { useEffect, useRef, useState } from 'react'
import { decode, isBlurhashValid } from 'blurhash'

// Presentational only: decodes a blurhash to a canvas. No auth, no fetch, no URL handling —
// the storefront and admin wrappers own those, since they sit on different trust boundaries.

const DECODE_SIZE = 32

export default function BlurhashCanvas({ hash, className }: { hash: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    const canvas = canvasRef.current
    if (!canvas) return
    if (!isBlurhashValid(hash).result) {
      setFailed(true)
      return
    }

    try {
      const pixels = decode(hash, DECODE_SIZE, DECODE_SIZE)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setFailed(true)
        return
      }
      const image = ctx.createImageData(DECODE_SIZE, DECODE_SIZE)
      image.data.set(pixels)
      ctx.putImageData(image, 0, 0)
    } catch {
      setFailed(true)
    }
  }, [hash])

  if (failed) return null

  return (
    <canvas
      ref={canvasRef}
      width={DECODE_SIZE}
      height={DECODE_SIZE}
      aria-hidden="true"
      className={className ?? 'absolute inset-0 w-full h-full'}
    />
  )
}
