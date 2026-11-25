// "Can a person see the page" checks (docs/plans/PER_SERVICE_TESTS_PLAN.md 3.1). Hit test at 9 points
// (including painted pointer-events:none layers), no opaque full-screen layer outside [data-app-root],
// not-blank screenshot, no page errors. Call after load and after anything that mounts an overlay.
import type { Page } from '@playwright/test'

const BUILTIN_ALLOW = ['ins.adsbygoogle', 'iframe[id^=aswift]', 'iframe[id^=google_ads]']
const MODAL = '[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]'
const HYDRATION = /hydrat|Minified React error #(418|419|422|423|425)\b/i
const MIN_LUMINANCE_VARIANCE = 1

const watchers = new WeakMap<Page, () => string[]>()

/** Starts collecting page errors and Hydration console errors; returns a getter for what was seen so far. */
export function watchPageErrors(page: Page): () => string[] {
  const seen = watchers.get(page)
  if (seen) return seen
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && HYDRATION.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  const get = () => [...errors]
  watchers.set(page, get)
  return get
}

async function probe(page: Page, allow: string[]): Promise<string[]> {
  return page.evaluate(
    ({ allow, modal }) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const failures: string[] = []
      const root = document.querySelector('[data-app-root]')
      if (!root) return ['no [data-app-root] element: the app root layout must carry the attribute']

      const num = (s: string) => (s === 'auto' ? NaN : parseFloat(s))
      const alphaOf = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/) || c.match(/color\(srgb ([^)]+)\)/)
        if (!m) return c === 'transparent' ? 0 : 1
        const parts = m[1].split(/[,\s/]+/).filter(Boolean)
        return parts.length > 3 ? parseFloat(parts[3]) : 1
      }
      const visible = (cs: CSSStyleDeclaration) =>
        cs.display !== 'none' && cs.visibility === 'visible' && parseFloat(cs.opacity) > 0
      const describe = (e: Element) => {
        const cs = getComputedStyle(e)
        const r = e.getBoundingClientRect()
        const cn = (e as HTMLElement).className
        const cls = typeof cn === 'string' ? cn.trim().replace(/\s+/g, '.') : ''
        return `<${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls ? '.' + cls : ''}> rect=[${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}] background=${cs.backgroundColor} opacity=${cs.opacity} pointer-events=${cs.pointerEvents} position=${cs.position} z-index=${cs.zIndex}`
      }
      const matchesAllow = (e: Element) =>
        allow.some(sel => {
          try {
            return !!e.closest(sel)
          } catch {
            return false
          }
        })
      const modals = Array.from(document.querySelectorAll(modal)).filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && visible(getComputedStyle(e))
      })
      const allowed = (e: Element) => root.contains(e) || !!e.closest(modal) || matchesAllow(e)
      const coversViewport = (e: Element, min: number) => {
        const r = e.getBoundingClientRect()
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        return (w * h) / (vw * vh) >= min
      }

      // Paint order: does a paint over b (stacking contexts compared root-first, then z-index, then DOM order).
      const creates = (cs: CSSStyleDeclaration) =>
        cs.position === 'fixed' ||
        cs.position === 'sticky' ||
        (cs.position !== 'static' && cs.zIndex !== 'auto') ||
        parseFloat(cs.opacity) < 1 ||
        cs.transform !== 'none' ||
        cs.filter !== 'none' ||
        cs.isolation === 'isolate'
      const chain = (e: Element) => {
        const out: { el: Element; z: number }[] = []
        for (let n: Element | null = e; n; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (creates(cs)) out.unshift({ el: n, z: num(cs.zIndex) || 0 })
        }
        return out
      }
      const above = (a: Element, b: Element) => {
        if (a === b || a.contains(b)) return false
        if (b.contains(a)) return true
        const ca = chain(a)
        const cb = chain(b)
        let i = 0
        while (i < ca.length && i < cb.length && ca[i].el === cb[i].el) i++
        const ka = ca[i] ?? { el: a, z: getComputedStyle(a).position === 'static' ? -1 : 0 }
        const kb = cb[i] ?? { el: b, z: getComputedStyle(b).position === 'static' ? -1 : 0 }
        if (ka.z !== kb.z) return ka.z > kb.z
        if (ka.el === kb.el) return false
        return !!(kb.el.compareDocumentPosition(ka.el) & Node.DOCUMENT_POSITION_FOLLOWING)
      }

      const skip = ['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT']
      const all = Array.from(document.querySelectorAll('*')).filter(e => !skip.includes(e.tagName))
      const outside = (e: Element) => e !== document.documentElement && e !== document.body && !e.contains(root) && !allowed(e)

      // 2. Opaque full-screen layer outside the app root (semi-transparent modal backdrops are fine).
      const flagged = new Set<Element>()
      for (const e of all) {
        if (!outside(e)) continue
        const cs = getComputedStyle(e)
        if (!visible(cs) || !coversViewport(e, 0.9)) continue
        if (alphaOf(cs.backgroundColor) * parseFloat(cs.opacity) >= 0.9) {
          flagged.add(e)
          failures.push(`opaque full-screen layer outside [data-app-root]: ${describe(e)}`)
        }
      }

      // 1. Hit test. elementsFromPoint skips pointer-events:none, so painted ones are checked separately.
      const ghosts = all.filter(e => {
        if (!outside(e)) return false
        const cs = getComputedStyle(e)
        if (cs.pointerEvents !== 'none' || !visible(cs) || cs.position === 'static') return false
        const r = e.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return false
        return alphaOf(cs.backgroundColor) >= 0.5 || cs.backgroundImage !== 'none' || ['IMG', 'VIDEO', 'CANVAS', 'SVG'].includes(e.tagName.toUpperCase())
      })
      const m = 8
      const points: [number, number][] = [
        [m, m], [vw - m, m], [m, vh - m], [vw - m, vh - m],
        [vw / 2, m], [vw / 2, vh - m], [m, vh / 2], [vw - m, vh / 2], [vw / 2, vh / 2],
      ]
      for (const [x, y] of points) {
        const top = document.elementsFromPoint(x, y)[0]
        const at = `at (${Math.round(x)},${Math.round(y)})`
        if (top && top !== document.documentElement && top !== document.body && !allowed(top)) {
          const backdrop = modals.length > 0 && coversViewport(top, 0.9)
          if (!backdrop && !flagged.has(top)) failures.push(`top element ${at} is outside [data-app-root], dialogs and the allowlist: ${describe(top)}`)
        }
        for (const g of ghosts) {
          const r = g.getBoundingClientRect()
          if (x < r.left || x > r.right || y < r.top || y > r.bottom || flagged.has(g)) continue
          if (!top || above(g, top)) failures.push(`painted pointer-events:none layer covers the page ${at}: ${describe(g)}`)
        }
      }
      return [...new Set(failures)]
    },
    { allow, modal: MODAL },
  )
}

// Luminance variance of a downsampled viewport screenshot, decoded on a scratch page so the app's CSP and
// DOM stay out of it.
async function luminanceVariance(page: Page): Promise<number> {
  const png = await page.screenshot({ type: 'png', caret: 'hide' })
  const scratch = await page.context().newPage()
  try {
    return await scratch.evaluate(async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const w = 64
      const h = 36
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bmp, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const lum: number[] = []
      for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
      const mean = lum.reduce((a, b) => a + b, 0) / lum.length
      return lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length
    }, png.toString('base64'))
  } finally {
    await scratch.close()
  }
}

/** Fails when a person would not see a working page. `allow` adds selectors to the top-element allowlist. */
export async function expectPageVisible(page: Page, opts: { allow?: string[] } = {}): Promise<void> {
  const errors = watchPageErrors(page)
  const failures = await probe(page, [...BUILTIN_ALLOW, ...(opts.allow ?? [])])
  const variance = await luminanceVariance(page)
  if (variance < MIN_LUMINANCE_VARIANCE) failures.push(`page looks blank: screenshot luminance variance ${variance.toFixed(2)} < ${MIN_LUMINANCE_VARIANCE}`)
  failures.push(...errors())
  if (failures.length) throw new Error(`expectPageVisible failed (${page.url()}):\n${failures.map(f => `  - ${f}`).join('\n')}`)
}
