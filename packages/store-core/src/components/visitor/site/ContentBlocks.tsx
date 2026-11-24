import Link from 'next/link'
import type { Block, PageKey } from '@jeffi/site-blocks'
import { getStoreIdentity, getStorefrontContent } from '@/lib/catalog/site-controls'
import { storeAddressLine } from '@/lib/catalog/brand'
import { responsiveImg, srcSetFor } from '@/lib/shared/image-url'
import ComposedBlock from './ComposedBlock'
import CodeSection from './code/CodeSection'
import type { CompiledSection } from '@/lib/site/code/compile'
import { mapsUrl, parseHours, phoneUrl } from '@/lib/site/hours'

// Store renderers for Site Builder's content blocks. Fluid by construction: stacks on phones, container-width on
// desktop, images in fixed-ratio boxes so nothing shifts while they load. `priority` marks the page's LCP image
// (eager, high fetch priority); every other image is lazy.

type P = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const paras = (text: string) => text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
const loadAttrs = (priority: boolean) =>
  priority ? ({ loading: 'eager', fetchPriority: 'high', decoding: 'sync' } as const) : ({ loading: 'lazy', decoding: 'async' } as const)
const RATIO: Record<string, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '4:3': 'aspect-[4/3]', '16:9': 'aspect-video' }

function Button({ label, href, light = false }: { label: string | null; href: string | null; light?: boolean }) {
  if (!label || !href) return null
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center min-h-12 px-5 rounded-[var(--radius-button,0.5rem)] text-sm font-semibold transition-colors ${
        light ? 'bg-white text-gray-900 hover:bg-gray-100' : 'bg-accent-500 text-white hover:bg-accent-600'
      }`}
    >
      {label}
    </Link>
  )
}

function Paragraphs({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`space-y-3 text-foreground-secondary leading-relaxed ${className}`}>
      {paras(text).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  )
}

function RichText({ p }: { p: P }) {
  const center = p.align === 'center'
  return (
    <section className="container mx-auto px-4 py-10 md:py-14">
      <div className={`${p.width === 'wide' ? 'max-w-5xl' : 'max-w-2xl'} ${center ? 'mx-auto text-center' : ''}`}>
        {str(p.heading) && <h2 className="font-display text-3xl md:text-4xl text-foreground mb-4">{str(p.heading)}</h2>}
        <Paragraphs text={String(p.body ?? '')} className="text-base md:text-lg" />
      </div>
    </section>
  )
}

function ImageText({ p, priority }: { p: P; priority: boolean }) {
  const right = p.imageSide === 'right'
  return (
    <section className="container mx-auto px-4 py-10 md:py-14">
      <div className="grid gap-6 md:gap-12 md:grid-cols-2 items-center">
        <div className={`${RATIO[String(p.aspect)] ?? RATIO['4:5']} relative overflow-hidden rounded-[var(--radius-card,0.75rem)] bg-surface-secondary ${right ? 'md:order-2' : ''}`}>
          {str(p.image) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img {...responsiveImg(str(p.image)!, '(min-width: 768px) 50vw, 100vw')} {...loadAttrs(priority)} alt={str(p.heading) ?? ''} className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>
        <div className="space-y-4">
          {str(p.heading) && <h2 className="font-display text-3xl md:text-4xl text-foreground">{str(p.heading)}</h2>}
          <Paragraphs text={String(p.body ?? '')} />
          <Button label={str(p.ctaLabel)} href={str(p.ctaUrl)} />
        </div>
      </div>
    </section>
  )
}

const HEIGHT: Record<string, string> = { short: 'min-h-[220px] md:min-h-[320px]', medium: 'min-h-[360px] md:min-h-[480px]', tall: 'min-h-[520px] md:min-h-[680px]' }

function ImageBanner({ p, priority }: { p: P; priority: boolean }) {
  const img = str(p.image)
  const mobile = str(p.mobileImage)
  const overlay = p.overlay === 'light' ? 'bg-white/45' : p.overlay === 'none' ? '' : 'bg-black/40'
  const light = p.overlay !== 'light'
  return (
    <section className={`relative flex items-center overflow-hidden bg-secondary-800 ${HEIGHT[String(p.height)] ?? HEIGHT.medium}`}>
      {img && (
        <picture>
          {mobile && <source media="(max-width: 767px)" sizes="100vw" srcSet={srcSetFor(mobile) ?? mobile} data-raw={mobile} />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img {...responsiveImg(img, '100vw')} {...loadAttrs(priority)} alt={str(p.heading) ?? ''} className="absolute inset-0 h-full w-full object-cover" />
        </picture>
      )}
      {overlay && <div className={`absolute inset-0 ${overlay}`} />}
      <div className={`relative container mx-auto px-4 py-10 ${p.align === 'left' ? 'text-left' : 'text-center'}`}>
        <div className={`max-w-2xl space-y-4 ${p.align === 'left' ? '' : 'mx-auto'} ${light ? 'text-white' : 'text-gray-900'}`}>
          {str(p.heading) && <h2 className="font-display text-4xl md:text-6xl leading-tight">{str(p.heading)}</h2>}
          {str(p.subheading) && <p className="text-base md:text-lg opacity-90">{str(p.subheading)}</p>}
          <Button label={str(p.ctaLabel)} href={str(p.ctaUrl)} light={light} />
        </div>
      </div>
    </section>
  )
}

function Faq({ p }: { p: P }) {
  const items = Array.isArray(p.items) ? (p.items as { q: string; a: string }[]) : []
  return (
    <section className="container mx-auto px-4 py-10 md:py-14">
      <div className="max-w-3xl mx-auto">
        {str(p.heading) && <h2 className="font-display text-3xl md:text-4xl text-foreground mb-6 text-center">{str(p.heading)}</h2>}
        <div className="divide-y divide-border-default rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated">
          {items.map((it, i) => (
            <details key={i} className="group px-4 md:px-6">
              <summary className="flex min-h-[52px] cursor-pointer items-center justify-between gap-4 py-3 font-medium text-foreground list-none">
                {it.q}
                <span className="text-xl text-foreground-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <Paragraphs text={it.a} className="pb-4" />
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

async function ContactDetails({ p }: { p: P }) {
  const [identity, content, address] = await Promise.all([getStoreIdentity(), getStorefrontContent(), storeAddressLine().catch(() => '')])
  const hours = parseHours(content.businessHours || '')
  const rows = [
    p.showEmail !== false && identity.email ? { label: 'Email', value: identity.email, href: `mailto:${identity.email}` } : null,
    p.showPhone !== false && identity.phone ? { label: 'Phone', value: identity.phone, href: phoneUrl(identity.phone) } : null,
    p.showAddress !== false && address ? { label: 'Address', value: address, href: mapsUrl(address) } : null,
  ].filter(Boolean) as { label: string; value: string; href: string }[]
  return (
    <section className="container mx-auto px-4 py-10 md:py-14">
      <div className="max-w-3xl mx-auto space-y-6">
        {str(p.heading) && <h2 className="font-display text-3xl md:text-4xl text-foreground text-center">{str(p.heading)}</h2>}
        {str(p.note) && <Paragraphs text={str(p.note)!} className="text-center" />}
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map(r => (
            <a key={r.label} href={r.href} className="rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated p-4 hover:border-accent-500 transition-colors">
              <span className="block text-xs uppercase tracking-wide text-foreground-muted">{r.label}</span>
              <span className="block mt-1 font-medium text-foreground break-words">{r.value}</span>
            </a>
          ))}
          {p.showHours !== false && hours.length > 0 && (
            <div className="rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface-elevated p-4 sm:col-span-2">
              <span className="block text-xs uppercase tracking-wide text-foreground-muted">Opening hours</span>
              <dl className="mt-2 grid gap-1">
                {hours.map(h => (
                  <div key={h.label} className="flex justify-between gap-4">
                    <dt className="text-foreground-secondary">{h.label}</dt>
                    <dd className="text-foreground">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** One content block, or null when the type is not a content block. */
/**
 * `always`: a code section draws even when its store data is empty (the page's first block, the Site Builder editor).
 * `preview`: the Site Builder canvas (a preview token), where code sections carry their `data-e` node ids.
 */
export function ContentBlock({ block, priority = false, always = false, page = null, preview = false }: { block: Block; priority?: boolean; always?: boolean; page?: PageKey | null; preview?: boolean }) {
  const p = block.props
  switch (block.type) {
    case 'rich_text':
      return <RichText p={p} />
    case 'image_text':
      return <ImageText p={p} priority={priority} />
    case 'image_banner':
      return <ImageBanner p={p} priority={priority} />
    case 'faq':
      return <Faq p={p} />
    case 'contact_details':
      return <ContactDetails p={p} />
    case 'composed':
      return <ComposedBlock props={p} priority={priority} />
    case 'code_section':
      return <CodeSection section={p.compiled as CompiledSection | null} page={page} priority={priority} always={always} preview={preview} />
    default:
      return null
  }
}
