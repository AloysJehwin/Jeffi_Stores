import type { ReactNode } from 'react'
import { responsiveImg } from '@/lib/shared/image-url'

/**
 * A sign-in or sign-up form, beside a picture panel when the block sets one (a heading or text alone gets a brand-colour
 * panel); stacked with the panel on top on phones. Without any, the form alone. `props.lcp` (set by SitePage when this
 * is the page's first picture) loads the picture eagerly.
 */
export default function AuthSplit({ props, form }: { props: Record<string, unknown>; form: (embedded: boolean) => ReactNode }) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const image = str(props.sideImage)
  const heading = str(props.sideHeading)
  const text = str(props.sideText)
  const lcp = props.lcp === true
  if (!image && !heading && !text) return <>{form(false)}</>
  const right = props.sidePosition === 'right'
  return (
    <section className="container mx-auto px-4 py-6 lg:py-12">
      <div className="grid overflow-hidden rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated lg:grid-cols-2">
        <div className={`relative min-h-[200px] lg:min-h-[560px] bg-secondary-800 ${right ? 'lg:order-2' : ''}`}>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              {...responsiveImg(image, '(min-width: 1024px) 50vw, 100vw')}
              alt=""
              loading={lcp ? 'eager' : 'lazy'}
              fetchPriority={lcp ? 'high' : undefined}
              decoding={lcp ? 'sync' : 'async'}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {(heading || text) && (
            <div className={`absolute inset-0 flex flex-col justify-end gap-2 p-6 lg:p-10 text-white ${image ? 'bg-gradient-to-t from-black/70 via-black/20 to-transparent' : ''}`}>
              {heading && <h2 className="font-display text-3xl lg:text-4xl leading-tight">{heading}</h2>}
              {text && <p className="text-base opacity-90 whitespace-pre-line">{text}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-center">{form(true)}</div>
      </div>
    </section>
  )
}
