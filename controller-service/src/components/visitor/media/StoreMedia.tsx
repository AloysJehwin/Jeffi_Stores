'use client'

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import StoreImage from '@/components/visitor/StoreImage'
import { optimizedUrl } from '@/lib/shared/image-url'

const REDUCED = '(prefers-reduced-motion: reduce)'
const GIF = /\.gif(?:[?#]|$)/i

/** Clips may play: no reduced-motion preference and no Save-Data. False on the server. */
export function canPlayVideo(): boolean {
  if (typeof window === 'undefined') return false
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false
  return typeof window.matchMedia !== 'function' || !window.matchMedia(REDUCED).matches
}

/** canPlayVideo, read after mount so the server and the first client render agree. */
export function useCanPlayVideo(): boolean {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED) : null
    const update = () => setOk(canPlayVideo())
    update()
    mq?.addEventListener?.('change', update)
    return () => mq?.removeEventListener?.('change', update)
  }, [])
  return ok
}

export interface StoreMediaProps {
  /** The picture, and the clip's poster. */
  image?: string | null
  /** MP4/WebM drawn over the picture. */
  video?: string | null
  blurhash?: string | null
  alt?: string
  sizes?: string
  /** On the default image and on the clip, so the clip fills the image's box. */
  className?: string
  /** The default image's wrapper. */
  wrapperClassName?: string
  /** False pauses the clip, e.g. on a slide that is not current. */
  active?: boolean
  priority?: boolean
  /** A story plays its clip once. */
  loop?: boolean
  /** The slot's own picture (SlideImage, a plain <img>); `className` then styles only the clip. */
  children?: ReactNode
  videoRef?: MutableRefObject<HTMLVideoElement | null>
  onLoadedMetadata?: (video: HTMLVideoElement) => void
  onEnded?: () => void
  /** The clip failed or the browser refused to play it; the picture stays. */
  onFail?: () => void
}

type ClipEvents = Pick<StoreMediaProps, 'videoRef' | 'onLoadedMetadata' | 'onEnded' | 'onFail'>

// A media slot: the picture as the slot draws it, with the clip over it playing only while on
// screen and `active`. Reduced motion and Save-Data get the picture alone.
export default function StoreMedia({
  image,
  video,
  blurhash,
  alt = '',
  sizes,
  className,
  wrapperClassName,
  active = true,
  priority,
  loop = true,
  children,
  ...events
}: StoreMediaProps) {
  const ok = useCanPlayVideo()
  const picture =
    children ??
    (image ? (
      <StoreImage
        src={image}
        alt={alt}
        blurhash={blurhash}
        priority={priority}
        sizes={sizes}
        className={className}
        wrapperClassName={wrapperClassName}
      />
    ) : null)
  const cls = `pointer-events-none ${className ?? ''}`
  return (
    <>
      {picture}
      {!ok || !video ? null : GIF.test(video) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video} alt="" aria-hidden="true" className={cls} />
      ) : (
        <Clip
          key={video}
          src={video}
          // The picture shows through until the first frame, so a resized poster is plenty.
          poster={image ? optimizedUrl(image, 1080) : image}
          // The picture carries the name; a clip without one is named itself.
          label={image ? undefined : alt || undefined}
          className={cls}
          active={active}
          loop={loop}
          {...events}
        />
      )}
    </>
  )
}

interface ClipProps extends ClipEvents {
  src: string
  poster?: string | null
  label?: string
  className: string
  active: boolean
  loop: boolean
}

function Clip({ src, poster, label, className, active, loop, videoRef, onLoadedMetadata, onEnded, onFail }: ClipProps) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [seen, setSeen] = useState(false)
  const failRef = useRef(onFail)
  useEffect(() => {
    failRef.current = onFail
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!active || !seen) {
      el.pause()
      return
    }
    el.muted = true
    el.play()?.catch((err: unknown) => {
      // AbortError is a pause() overtaking the play(); anything else (autoplay refused) keeps the poster.
      if ((err as { name?: string } | null)?.name !== 'AbortError') failRef.current?.()
    })
  }, [active, seen])

  return (
    <video
      ref={el => {
        ref.current = el
        if (videoRef) videoRef.current = el
      }}
      src={src}
      poster={poster ?? undefined}
      muted
      loop={loop}
      playsInline
      preload="none"
      disablePictureInPicture
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      onLoadedMetadata={e => onLoadedMetadata?.(e.currentTarget)}
      onEnded={onEnded}
      onError={() => failRef.current?.()}
    />
  )
}
