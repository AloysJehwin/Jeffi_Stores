import BlurhashCanvas from '@/components/ui/BlurhashCanvas'

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
}: SlideImageProps) {
  // The canvas sits under the <picture>, whose default <img> is the mobile source, so prefer the
  // hash of whatever renders first.
  const hash = card ? blurhashCard || blurhash || blurhashMobile : blurhashMobile || blurhash
  const wide = src || mobileSrc || placeholder
  const narrow = mobileSrc || src || placeholder
  const single = card ? cardSrc || src || mobileSrc || placeholder : null

  return (
    <>
      {hash && (
        <div className={blurClassName}>
          <BlurhashCanvas hash={hash} />
        </div>
      )}
      {single ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={single} alt={alt} loading={loading} className={className} />
      ) : (
        narrow && (
          <picture>
            {wide && wide !== narrow && <source media={`(min-width: ${breakpoint}px)`} srcSet={wide} />}
            <img src={narrow} alt={alt} loading={loading} className={className} />
          </picture>
        )
      )}
    </>
  )
}
