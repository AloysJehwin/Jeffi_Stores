'use client'

import BlurhashCanvas from '@/components/ui/BlurhashCanvas'
import { onImgError, srcSetFor } from '@/lib/shared/image-url'

export interface SlideImageProps {
  /** The wide (desktop) image. */
  src?: string | null
  mobileSrc?: string | null
  /** A 4:5 card image; with `card` it wins over the wide and mobile ones. */
  cardSrc?: string | null
  blurhash?: string | null
  blurhashMobile?: string | null
  blurhashCard?: string | null
  /** Render the card source instead of the wide/mobile pair. */
  card?: boolean
  /** Width in px from which the wide image replaces the mobile one. */
  breakpoint?: number
  /** Used when no source is set at all. */
  placeholder?: string
  alt?: string
  loading?: 'eager' | 'lazy'
  className?: string
  /** Wraps the blurhash canvas; defaults to filling the slide. */
  blurClassName?: string
  /** Rendered width for the resized srcset; defaults to the full width (wide) or half of it (card). */
  sizes?: string
}

// A slide's backdrop: the blurhash under a <picture> that swaps the mobile image for the wide one
// at `breakpoint`. Each source falls back to the other, so one upload is enough.
export default function SlideImage({
  src,
  mobileSrc,
  cardSrc,
  blurhash,
  blurhashMobile,
  blurhashCard,
  card = false,
  breakpoint = 640,
  placeholder,
  alt = '',
  loading,
  className = 'absolute inset-0 h-full w-full object-cover object-center',
  blurClassName = 'absolute inset-0',
  sizes,
}: SlideImageProps) {
  // The canvas sits under the <picture>, whose default <img> is the mobile source, so prefer the
  // hash of whatever renders first.
  const hash = card ? blurhashCard || blurhash || blurhashMobile : blurhashMobile || blurhash
  const wide = src || mobileSrc || placeholder
  const narrow = mobileSrc || src || placeholder
  const single = card ? cardSrc || src || mobileSrc || placeholder : null
  const shown = sizes ?? (card ? '(min-width: 1024px) 50vw, 100vw' : '100vw')
  const set = (u: string | null | undefined) => srcSetFor(u, shown)

  return (
    <>
      {hash && (
        <div className={blurClassName}>
          <BlurhashCanvas hash={hash} />
        </div>
      )}
      {single ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          sizes={shown}
          srcSet={set(single)}
          src={single}
          alt={alt}
          loading={loading}
          className={className}
          onError={onImgError}
        />
      ) : (
        narrow && (
          <picture>
            {wide && wide !== narrow && (
              <source media={`(min-width: ${breakpoint}px)`} sizes={shown} srcSet={set(wide) ?? wide} data-raw={wide} />
            )}
            <img
              sizes={shown}
              srcSet={set(narrow)}
              src={narrow}
              alt={alt}
              loading={loading}
              className={className}
              onError={onImgError}
            />
          </picture>
        )
      )}
    </>
  )
}
