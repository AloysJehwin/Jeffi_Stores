'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { backdropImg, onImgError } from '@/lib/shared/image-url'
import Slides from './slides/Slides'
import { useSwipe } from './slides/useSwipe'

interface ProductImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
  blurhash?: string | null
}

interface ProductImageGalleryProps {
  images: ProductImage[]
  productName: string
  variantImages?: ProductImage[]
  discountPct?: number | null
  ribbonLabel?: string
}

const DESKTOP_QUERY = '(min-width: 1024px)'
// The phone pager and the desktop main image share one size, so both pick the same download; the
// desktop share leaves headroom for the hover zoom.
const MAIN_SIZES = '(min-width: 1024px) 60vw, 100vw'

const wrap = (i: number, n: number) => ((i % n) + n) % n

function onArrowKey(e: React.KeyboardEvent | KeyboardEvent, step: (d: 1 | -1) => void) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  step(e.key === 'ArrowRight' ? 1 : -1)
}

export default function ProductImageGallery({
  images,
  productName,
  variantImages,
  discountPct,
  ribbonLabel,
}: ProductImageGalleryProps) {
  const displayImages = variantImages && variantImages.length > 0 ? variantImages : images
  const count = displayImages.length
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  // Where thumbs, keys and the lightbox send the phone pager. It holds until the pager lands there,
  // so the pages it scrolls past on the way don't pull the selection back.
  const [pagerTarget, setPagerTarget] = useState<number>()
  const [pagerKey, setPagerKey] = useState(0)
  const [isZoomed, setIsZoomed] = useState(false)
  const [showLightbox, setShowLightbox] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // A new variant starts on its first image.
  const [shownVariant, setShownVariant] = useState(variantImages)
  if (shownVariant !== variantImages) {
    setShownVariant(variantImages)
    setSelectedImageIndex(0)
    setPagerTarget(0)
  }

  // The pager is display:none on desktop, so it is remounted on the current image when it shows again.
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP_QUERY)
    if (!mq) return
    const onChange = () => {
      if (!mq.matches) setPagerKey(k => k + 1)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const select = useCallback((i: number) => {
    setSelectedImageIndex(i)
    setPagerTarget(i)
  }, [])
  const closeLightbox = useCallback(() => setShowLightbox(false), [])

  if (count === 0) {
    return (
      <div className="relative bg-surface-elevated rounded-xl overflow-hidden border border-border-default">
        <div className="w-full h-96 flex items-center justify-center">
          <svg className="w-32 h-32 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>
    )
  }

  const active = Math.min(selectedImageIndex, count - 1)
  const currentImage = displayImages[active]
  const hasSale = discountPct != null && discountPct > 0

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isZoomed) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    setMousePosition({ x, y })
  }

  const onPagerChange = (i: number) => {
    if (pagerTarget !== undefined && i !== pagerTarget) return
    setPagerTarget(undefined)
    setSelectedImageIndex(i)
  }
  // The user took hold of the pager, so it leads again.
  const releasePager = () => setPagerTarget(undefined)

  const onGalleryKey = (e: React.KeyboardEvent) => {
    // The pager's track handles its own arrows.
    if (e.defaultPrevented || count < 2) return
    onArrowKey(e, d => select(wrap(active + d, count)))
  }

  const businessRibbon = ribbonLabel && (
    <div className="absolute top-6 right-[-36px] w-44 rotate-45 bg-gradient-to-r from-amber-500 to-rose-500 text-white text-[11px] font-bold text-center py-1.5 shadow-md pointer-events-none select-none z-10">
      {ribbonLabel}
    </div>
  )
  const saleRibbon = hasSale && (
    <div className="absolute top-7 right-[-28px] w-32 rotate-45 bg-gradient-to-r from-rose-500 to-orange-500 text-white text-xs font-bold text-center py-1 shadow-md pointer-events-none select-none z-10">
      SALE
    </div>
  )

  return (
    <>
      <div onKeyDown={onGalleryKey}>
        {/* Phones and tablets: a swipe pager */}
        <div
          className="relative lg:hidden mb-4"
          onPointerDownCapture={releasePager}
          onWheelCapture={releasePager}
          onKeyDownCapture={releasePager}
        >
          {/* The arrows' -mt centres them on the image rather than the image plus the dots. */}
          <Slides
            key={`${pagerKey}:${displayImages.map(img => img.id).join()}`}
            layout="banner"
            ariaLabel={`${productName} images`}
            itemLabel="image"
            index={pagerTarget}
            defaultIndex={active}
            onIndexChange={onPagerChange}
            trackClassName="gap-0"
            arrows={{ className: '-mt-2.5' }}
            dots={{ tone: 'brand', label: i => `Show image ${i + 1}`, className: 'mt-3 justify-center' }}
          >
            {displayImages.map((image, index) => {
              const loading = index === active ? undefined : 'lazy'
              return (
                <button
                  key={image.id}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setShowLightbox(true)}
                  className="relative block w-full aspect-[5/3] overflow-hidden rounded-xl border border-border-default bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    {...backdropImg(image.image_url)}
                    onError={onImgError}
                    alt=""
                    aria-hidden="true"
                    loading={loading}
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                  />
                  <ImgWithSkeleton
                    src={image.image_url}
                    alt={`${productName} - Image ${index + 1}`}
                    blurhash={image.blurhash}
                    loading={loading}
                    sizes={MAIN_SIZES}
                    className="w-full h-full object-contain"
                  />
                </button>
              )
            })}
          </Slides>
          {(businessRibbon || saleRibbon) && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 aspect-[5/3] overflow-hidden rounded-xl">
              {businessRibbon}
              {saleRibbon}
            </div>
          )}
        </div>

        {/* Desktop: main image with hover zoom */}
        <div
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          className="relative bg-surface-elevated rounded-xl overflow-hidden mb-4 cursor-zoom-in group border border-border-default hidden lg:block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          onMouseEnter={() => setIsZoomed(true)}
          onMouseLeave={() => setIsZoomed(false)}
          onMouseMove={handleMouseMove}
          onClick={() => setShowLightbox(true)}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            setShowLightbox(true)
          }}
        >
          {businessRibbon}
          <div className="w-full aspect-[5/3] relative overflow-hidden flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...backdropImg(currentImage.image_url)}
              onError={onImgError}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
            />
            <div
              className={`relative w-full h-full transition-transform duration-300 motion-reduce:transition-none ${isZoomed ? 'scale-150' : 'scale-100'}`}
              style={isZoomed ? { transformOrigin: `${mousePosition.x}% ${mousePosition.y}%` } : {}}
            >
              <ImgWithSkeleton
                key={currentImage.image_url}
                src={currentImage.image_url}
                alt={`${productName} - Image ${active + 1}`}
                blurhash={currentImage.blurhash}
                sizes={MAIN_SIZES}
                className="w-full h-full object-contain animate-fade-in motion-reduce:animate-none"
              />
            </div>
          </div>

          {saleRibbon}

          {/* Hover Overlay */}
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-5 transition-opacity pointer-events-none" />

          {/* Click to Expand Hint */}
          <div
            aria-hidden="true"
            className="absolute bottom-4 right-4 bg-black bg-opacity-60 text-white px-3 py-2 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <svg className="w-5 h-5 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
              />
            </svg>
            Click to expand
          </div>
        </div>

        {/* Thumbnail Images */}
        {count > 1 && (
          <div className="grid grid-cols-4 gap-3">
            {displayImages.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => select(index)}
                aria-current={index === active ? 'true' : undefined}
                className={`relative bg-surface-elevated rounded-lg overflow-hidden cursor-pointer border-2 transition-all motion-reduce:transition-none hover:scale-[1.03] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  index === active ? 'border-accent-500 scale-[1.02]' : 'border-border-default hover:border-accent-300'
                }`}
              >
                <div className="w-full h-20 flex items-center justify-center">
                  <ImgWithSkeleton
                    src={image.thumbnail_url}
                    alt={`${productName} - Thumbnail ${index + 1}`}
                    blurhash={image.blurhash}
                    sizes="128px"
                    className="w-full h-full object-contain bg-surface-secondary rounded-md"
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showLightbox && (
        <Lightbox
          images={displayImages}
          index={active}
          productName={productName}
          onIndex={select}
          onClose={closeLightbox}
        />
      )}
    </>
  )
}

interface Zoom {
  s: number
  x: number
  y: number
}

interface Frame {
  cx: number
  cy: number
  w: number
  h: number
}

type Gesture =
  | { kind: 'pinch'; s: number; d: number; ux: number; uy: number }
  | { kind: 'pan'; px: number; py: number; tx: number; ty: number }

const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 }
const MAX_ZOOM = 4
const TAP_ZOOM = 2
const TAP_MS = 300
const SLOP_PX = 10
const CLICK_GUARD_MS = 600

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Keeps the zoomed image covering its own box.
function fit(s: number, x: number, y: number, f: Frame): Zoom {
  const mx = ((s - 1) * f.w) / 2
  const my = ((s - 1) * f.h) / 2
  return { s, x: clamp(x, -mx, mx), y: clamp(y, -my, my) }
}

// Pinch, drag and double-tap zoom on a transform. The browser's own pinch would zoom the page
// under the overlay, and Safari has no touch-action: pinch-zoom.
function usePinchZoom(box: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(NO_ZOOM)
  const [easing, setEasing] = useState(false)
  const cur = useRef(NO_ZOOM)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const tap = useRef<{ id: number; x: number; y: number; t: number } | null>(null)
  const lastTap = useRef(0)
  const movedAt = useRef(0)

  const apply = (z: Zoom) => {
    cur.current = z
    setZoom(z)
  }

  const frame = (): Frame | null => {
    const r = box.current?.getBoundingClientRect()
    return r?.width ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null
  }

  // Restarts from the pointers now down, so lifting one finger of a pinch carries on as a drag.
  const begin = () => {
    const f = frame()
    const [a, b] = Array.from(pts.current.values())
    const z = cur.current
    if (f && a && b) {
      const mx = (a.x + b.x) / 2 - f.cx
      const my = (a.y + b.y) / 2 - f.cy
      gesture.current = {
        kind: 'pinch',
        s: z.s,
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        ux: (mx - z.x) / z.s,
        uy: (my - z.y) / z.s,
      }
    } else if (f && a && z.s > 1) gesture.current = { kind: 'pan', px: a.x, py: a.y, tx: z.x, ty: z.y }
    else gesture.current = null
  }

  const end = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId)
    begin()
    if (!pts.current.size && cur.current.s !== 1 && cur.current.s < 1.02) apply(NO_ZOOM)
  }

  return {
    zoom,
    easing,
    reset: () => {
      gesture.current = null
      apply(NO_ZOOM)
    },
    /** Returns the number of pointers down. */
    down: (e: React.PointerEvent) => {
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      tap.current =
        pts.current.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null
      setEasing(false)
      begin()
      return pts.current.size
    },
    move: (e: React.PointerEvent) => {
      const p = pts.current.get(e.pointerId)
      if (!p) return
      p.x = e.clientX
      p.y = e.clientY
      const t = tap.current
      if (t && Math.hypot(p.x - t.x, p.y - t.y) > SLOP_PX) tap.current = null
      const g = gesture.current
      const f = frame()
      if (!g || !f) return
      if (!tap.current) movedAt.current = performance.now()
      if (g.kind === 'pinch') {
        const [a, b] = Array.from(pts.current.values())
        if (!b) return
        const s = clamp((g.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.d, 1, MAX_ZOOM)
        apply(fit(s, (a.x + b.x) / 2 - f.cx - s * g.ux, (a.y + b.y) / 2 - f.cy - s * g.uy, f))
      } else apply(fit(cur.current.s, g.tx + p.x - g.px, g.ty + p.y - g.py, f))
    },
    up: (e: React.PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return
      const t = tap.current
      tap.current = null
      const tapped =
        t?.id === e.pointerId && performance.now() - t.t < TAP_MS && box.current?.contains(e.target as Node)
      if (tapped) {
        const now = performance.now()
        if (now - lastTap.current < TAP_MS) {
          lastTap.current = 0
          const f = frame()
          setEasing(true)
          if (cur.current.s > 1 || !f) apply(NO_ZOOM)
          else apply(fit(TAP_ZOOM, (1 - TAP_ZOOM) * (e.clientX - f.cx), (1 - TAP_ZOOM) * (e.clientY - f.cy), f))
        } else lastTap.current = now
      }
      end(e)
    },
    cancel: (e: React.PointerEvent) => {
      tap.current = null
      end(e)
    },
    /** Swallows the click that ends a drag or pinch, so letting go over the backdrop doesn't close. */
    guardClick: (e: React.MouseEvent) => {
      if (!movedAt.current || performance.now() - movedAt.current > CLICK_GUARD_MS) return false
      movedAt.current = 0
      e.preventDefault()
      e.stopPropagation()
      return true
    },
  }
}

interface LightboxProps {
  images: ProductImage[]
  index: number
  productName: string
  onIndex: (index: number) => void
  onClose: () => void
}

function Lightbox({ images, index, productName, onIndex, onClose }: LightboxProps) {
  const count = images.length
  const many = count > 1
  const image = images[index]
  const reduced = !!useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const pinch = usePinchZoom(boxRef)
  const { s, x, y } = pinch.zoom
  const zoomed = s > 1

  const go = (i: number) => {
    pinch.reset()
    onIndex(wrap(i, count))
  }
  const swipe = useSwipe({ onSwipe: d => go(index + d), enabled: many && !zoomed })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (many) onArrowKey(e, d => go(index + d))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      if (back && document.contains(back) && !back.closest('[inert]')) back.focus()
    }
  }, [])

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const items = dialogRef.current?.querySelectorAll<HTMLElement>('button')
    if (!items?.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Buttons and the thumbnail strip keep their own taps and scrolling.
  const ownGesture = (e: React.PointerEvent) =>
    e.button !== 0 || !!(e.target as HTMLElement).closest('button, [data-no-gesture]')

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${productName} images`}
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4 overflow-hidden touch-none select-none"
      onClick={onClose}
      onKeyDown={trapTab}
      onPointerDown={e => {
        if (ownGesture(e)) return
        // A second finger makes it a pinch, not a swipe.
        if (pinch.down(e) > 1) swipe.bind.onPointerCancel()
        else swipe.bind.onPointerDown(e)
      }}
      onPointerMove={e => {
        pinch.move(e)
        swipe.bind.onPointerMove(e)
      }}
      onPointerUp={e => {
        pinch.up(e)
        swipe.bind.onPointerUp(e)
      }}
      onPointerCancel={e => {
        pinch.cancel(e)
        swipe.bind.onPointerCancel()
      }}
      onClickCapture={e => {
        if (!pinch.guardClick(e)) swipe.bind.onClickCapture(e)
      }}
      onDragStart={swipe.bind.onDragStart}
    >
      {/* Close Button */}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] p-2 text-white hover:text-gray-300 transition-colors z-10"
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Image Counter */}
      <div
        aria-live="polite"
        className="absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] text-white text-sm bg-black bg-opacity-60 px-4 py-2 rounded-lg z-10"
      >
        {index + 1} / {count}
      </div>

      {/* Main Image in Lightbox */}
      <div className="relative flex items-center justify-center" onClick={e => e.stopPropagation()}>
        <div
          ref={boxRef}
          className={`max-w-full max-h-[85vh] w-auto h-auto ${zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        >
          <div
            className={pinch.easing && !reduced ? 'transition-transform duration-200 ease-out' : undefined}
            style={zoomed ? { transform: `translate(${x}px, ${y}px) scale(${s})` } : undefined}
          >
            <ImgWithSkeleton
              src={image.image_url}
              alt={`${productName} - Image ${index + 1}`}
              blurhash={image.blurhash}
              className="max-w-full max-h-[85vh] w-auto h-auto object-contain"
            />
          </div>
        </div>

        {/* Navigation Arrows */}
        {many && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous image"
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-60 hover:bg-opacity-80 text-white p-3 rounded-full transition-all"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next image"
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black bg-opacity-60 hover:bg-opacity-80 text-white p-3 rounded-full transition-all"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Thumbnail Navigation in Lightbox */}
      {many && (
        <div
          data-no-gesture=""
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex gap-2 bg-black bg-opacity-60 p-2 rounded-lg max-w-full overflow-x-auto"
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={e => {
                e.stopPropagation()
                go(i)
              }}
              aria-current={i === index ? 'true' : undefined}
              className={`flex-shrink-0 w-16 h-16 rounded border-2 transition-all ${
                i === index ? 'border-accent-500' : 'border-transparent hover:border-accent-300'
              }`}
            >
              <ImgWithSkeleton
                src={img.thumbnail_url}
                alt={`Thumbnail ${i + 1}`}
                blurhash={img.blurhash}
                className="w-full h-full object-contain bg-surface-secondary overflow-hidden rounded"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
