import type { SyntheticEvent } from 'react'
import cfg from './image-optimizer.json'

// Storefront photos through Next's optimizer (/_next/image): resized to the width the layout needs and
// served as WebP. Only hosts next.config.js allows (the same JSON) and site-relative files are rewritten;
// GIFs (animation), SVGs, data:/blob: URLs and other hosts pass through untouched.

export const IMAGE_WIDTHS: readonly number[] = [...cfg.imageSizes, ...cfg.deviceSizes]
const MAX_WIDTH = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]
const HOSTS = cfg.hosts.map(h => new RegExp(`^${h.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9-]+')}$`, 'i'))
const PASS_THROUGH = /\.(?:gif|svg)$/i

export function canOptimize(src: string | null | undefined): src is string {
  if (!src) return false
  if (src.startsWith('/'))
    return !src.startsWith('//') && !src.startsWith('/_next/') && !PASS_THROUGH.test(src.split('?')[0])
  let u: URL
  try {
    u = new URL(src)
  } catch {
    return false
  }
  return u.protocol === 'https:' && HOSTS.some(re => re.test(u.hostname)) && !PASS_THROUGH.test(u.pathname)
}

/** The optimizer URL at the smallest allowed width ≥ `width`; `src` itself when it can't be optimized. */
export function optimizedUrl(src: string, width: number): string {
  if (!canOptimize(src)) return src
  const w = IMAGE_WIDTHS.find(x => x >= width) ?? MAX_WIDTH
  return `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${cfg.quality}`
}

// A fixed `sizes` like "80px" never needs more than 3x that; anything relative may need every width.
function widthsFor(sizes: string): readonly number[] {
  const px = /^\s*(\d+)px\s*$/.exec(sizes)
  if (!px) return IMAGE_WIDTHS
  const cap = Number(px[1]) * 3
  return IMAGE_WIDTHS.filter((w, i) => w <= cap || IMAGE_WIDTHS[i - 1] < cap)
}

export function srcSetFor(src: string | null | undefined, sizes = '100vw'): string | undefined {
  if (!canOptimize(src)) return undefined
  return widthsFor(sizes)
    .map(w => `${optimizedUrl(src, w)} ${w}w`)
    .join(', ')
}

/**
 * After a failed optimized load, retry the original: drops the img's srcset (the original src stays),
 * restores `data-raw` on its <picture> sources and on an optimized src. False when nothing was left
 * to retry, so the caller can stop waiting.
 */
export function fallBackToOriginal(img: HTMLImageElement): boolean {
  const pic = img.parentElement instanceof HTMLPictureElement ? img.parentElement : null
  const sources = pic
    ? Array.from(pic.querySelectorAll('source')).filter(s => s.dataset.raw && s.srcset !== s.dataset.raw)
    : []
  const raw = img.dataset.raw
  const swap = !!raw && img.getAttribute('src') !== raw
  const hasSet = img.hasAttribute('srcset')
  if (!hasSet && !swap && !sources.length) return false
  for (const s of sources) {
    s.srcset = s.dataset.raw!
    s.removeAttribute('sizes')
  }
  if (hasSet) img.removeAttribute('srcset')
  if (swap) img.src = raw!
  return true
}

/** onError for a client <img>/<picture> built with the helpers below. */
export const onImgError = (e: SyntheticEvent<HTMLImageElement>) => void fallBackToOriginal(e.currentTarget)

// Both return plain props, so server components can use them; client ones add onError={onImgError}.

/** Props for a plain <img> shown at `sizes`: the original src plus an optimized srcset. */
export function responsiveImg(src: string, sizes: string) {
  const srcSet = srcSetFor(src, sizes)
  return srcSet ? { sizes, srcSet, src } : { src }
}

/** A small copy for a blurred backdrop; `data-raw` keeps the original for onImgError. */
export function backdropImg(src: string) {
  const small = optimizedUrl(src, 64)
  return small === src ? { src } : { src: small, 'data-raw': src }
}
