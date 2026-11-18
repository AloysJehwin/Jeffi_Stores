/* eslint-env browser */
// Runs inside the page (page.evaluate): self-contained, no imports used at runtime. Chromium (typed OM).

export type FindingKind = 'overflow' | 'clipped-text' | 'tap-target' | 'image-size' | 'render'

export interface Finding {
  kind: FindingKind
  severity: 'error' | 'warning'
  /** tag#id.classes "text" */
  element: string
  blockId: string | null
  detail: string
}

export interface AuditResult {
  findings: Finding[]
  viewport: number
  docWidth: number
  blocks: number
}

export interface AuditOptions {
  /** The viewport width the page was set to. */
  width: number
  minTap: number
  warnTap: number
  /** Check tap targets (touch widths only). */
  taps: boolean
}

export function auditInPage(opts: AuditOptions): AuditResult {
  const findings: Finding[] = []
  const vw = Math.min(document.documentElement.clientWidth || opts.width, opts.width)
  const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  const IGNORE = 'nextjs-portal, [data-sweep-ignore], script, style, noscript, template'

  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).map(c => `.${c}`).join('') : ''
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${tag}${id}${cls}${text ? ` "${text}"` : ''}`
  }
  const blockOf = (el: Element) => el.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null
  const ignored = (el: Element) => !!el.closest(IGNORE)
  const visible = (el: Element) => {
    const e = el as HTMLElement & { checkVisibility?: (o: object) => boolean }
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const hides = (v: string) => v === 'hidden' || v === 'clip'
  // Computed (not resolved) values: `auto` and percentages stay as written.
  const typed = (el: Element, prop: string) => {
    const map = (el as Element & { computedStyleMap?: () => { get(p: string): unknown } }).computedStyleMap?.()
    try {
      return map ? String(map.get(prop) ?? '') : ''
    } catch {
      return ''
    }
  }

  // 0. A server render that threw (Next falls back to client rendering and leaves the message in a template).
  for (const t of Array.from(document.querySelectorAll('template[data-msg]'))) {
    const msg = (t.getAttribute('data-msg') || '').split('\n').filter(Boolean).pop() || 'server render errored'
    if (!findings.some(f => f.kind === 'render' && f.detail === msg)) findings.push({ kind: 'render', severity: 'error', element: 'document', blockId: null, detail: msg.slice(0, 200) })
  }

  // 1. Horizontal overflow: the document wider than the viewport, or content past it that overflow-x on html/body
  // hides. Names the outermost offenders no ancestor clips (fixed layers never widen the page).
  const rootClips = [document.documentElement, document.body].some(e => hides(getComputedStyle(e).overflowX))
  if (docWidth > vw + 1 || rootClips) {
    const offenders: Element[] = []
    let right = vw
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (ignored(el) || !visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right <= vw + 1 && r.left >= -1) continue
      if (getComputedStyle(el).position === 'fixed') continue
      let clipped = false
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a)
        if (cs.overflowX !== 'visible' || cs.position === 'fixed') {
          clipped = true
          break
        }
      }
      if (clipped || offenders.some(o => o.contains(el))) continue
      offenders.push(el)
      right = Math.max(right, Math.round(r.right))
    }
    if (docWidth > vw + 1 || offenders.length) {
      findings.push({
        kind: 'overflow',
        severity: 'error',
        element: offenders.slice(0, 5).map(describe).join(' | ') || 'document',
        blockId: offenders[0] ? blockOf(offenders[0]) : null,
        detail: docWidth > vw + 1 ? `document ${docWidth}px wide in a ${vw}px viewport` : `content reaches ${right}px in a ${vw}px viewport, hidden by overflow-x on html/body`,
      })
    }
  }

  // 2. Clipped text: a text run that crosses the edge of an ancestor that hides overflow (or the viewport), unless
  // that ancestor truncates on purpose (text-overflow: ellipsis / line-clamp). A run wholly outside is a warning
  // (sliders and marquees park content there).
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    const parent = node.parentElement
    if (!parent || seen.has(parent)) continue
    seen.add(parent)
    if (ignored(parent) || !visible(parent)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
    if (rects.length === 0) continue
    const text = {
      left: Math.min(...rects.map(r => r.left)),
      right: Math.max(...rects.map(r => r.right)),
      top: Math.min(...rects.map(r => r.top)),
      bottom: Math.max(...rects.map(r => r.bottom)),
    }
    let box = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity }
    let clipper: Element | null = null
    let truncates = false
    let animated = false
    for (let a: Element | null = parent; a; a = a.parentElement) {
      const cs = getComputedStyle(a)
      const clamp = cs.getPropertyValue('-webkit-line-clamp')
      if (cs.textOverflow === 'ellipsis' || (clamp && clamp !== 'none')) truncates = true
      if (cs.animationName !== 'none') animated = true
      const isRoot = a === document.documentElement || a === document.body
      if (hides(cs.overflowX) || hides(cs.overflowY) || (isRoot && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll')) {
        const r = isRoot ? { left: 0, right: vw, top: -Infinity, bottom: Infinity } : a.getBoundingClientRect()
        if (hides(cs.overflowX) || isRoot) box = { ...box, left: Math.max(box.left, r.left), right: Math.min(box.right, r.right) }
        if (!isRoot && hides(cs.overflowY)) box = { ...box, top: Math.max(box.top, r.top), bottom: Math.min(box.bottom, r.bottom) }
        if (!clipper) clipper = a
        if (truncates) break
      }
    }
    if (!clipper || truncates) continue
    const tol = 2
    const outsideX = text.right > box.right + tol || text.left < box.left - tol
    const outsideY = text.bottom > box.bottom + tol || text.top < box.top - tol
    if (!outsideX && !outsideY) continue
    const wholly = text.left >= box.right - tol || text.right <= box.left + tol || text.top >= box.bottom - tol || text.bottom <= box.top + tol
    const cut = outsideX ? `${Math.round(Math.max(text.right - box.right, box.left - text.left))}px horizontally` : `${Math.round(Math.max(text.bottom - box.bottom, box.top - text.top))}px vertically`
    findings.push({
      kind: 'clipped-text',
      severity: wholly || animated ? 'warning' : 'error',
      element: describe(parent),
      blockId: blockOf(parent),
      detail: `${wholly ? 'wholly outside' : 'cut off'} ${cut} by ${describe(clipper)}${animated ? ' (animated)' : ''}`,
    })
  }

  // 3. Tap targets in Site Builder blocks. A link stretched over its card by an absolute ::after/::before counts the
  // card's box.
  const hitRect = (el: Element) => {
    for (const pseudo of ['::after', '::before']) {
      const ps = getComputedStyle(el, pseudo)
      if (ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute') continue
      if (!['top', 'right', 'bottom', 'left'].every(k => parseFloat(ps.getPropertyValue(k)) <= 0)) continue
      let cb: Element | null = el
      while (cb && cb !== document.body && getComputedStyle(cb).position === 'static') cb = cb.parentElement
      if (cb) return cb.getBoundingClientRect()
    }
    return el.getBoundingClientRect()
  }
  const targets = opts.taps
    ? document.querySelectorAll('[data-block-id] a[href], [data-block-id] button, [data-block-id] [role="button"], [data-block-id] summary, [data-block-id] input[type="submit"], [data-block-id] input[type="button"]')
    : []
  for (const el of Array.from(targets)) {
    if (ignored(el) || !visible(el)) continue
    if (el.parentElement?.closest('a[href], button, [role="button"]')) continue // nested in another target
    const r = hitRect(el)
    const min = Math.min(r.width, r.height)
    if (min >= opts.warnTap) continue
    const cs = getComputedStyle(el)
    const inline =
      cs.display === 'inline' &&
      !!el.parentElement &&
      Array.from(el.parentElement.childNodes).some(n => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim())
    const size = `${Math.round(r.width)}×${Math.round(r.height)}px`
    findings.push({
      kind: 'tap-target',
      severity: min < opts.minTap && !inline ? 'error' : 'warning',
      element: describe(el),
      blockId: blockOf(el),
      detail: inline ? `${size} inline text link` : `${size} (min ${opts.minTap}, want ${opts.warnTap})`,
    })
  }

  // 4. Images in blocks need a box that does not wait for the file: width+height attributes, a CSS aspect-ratio (own
  // or an ancestor's), or a width and a definite height from CSS (a length, an absolute fill, or a percentage of a
  // parent that has one).
  const definiteHeight = (el: Element | null, depth = 0): boolean => {
    if (!el || depth > 6) return false
    const cs = getComputedStyle(el)
    const h = typed(el, 'height')
    if (h && h !== 'auto' && !h.includes('%')) return true
    if (cs.aspectRatio !== 'auto') return true
    if ((cs.position === 'absolute' || cs.position === 'fixed') && typed(el, 'top') !== 'auto' && typed(el, 'bottom') !== 'auto') return true
    return h.includes('%') && definiteHeight(el.parentElement, depth + 1)
  }
  for (const img of Array.from(document.querySelectorAll('[data-block-id] img'))) {
    if (ignored(img)) continue
    const cs = getComputedStyle(img)
    if (cs.display === 'none') continue
    const w = Number(img.getAttribute('width'))
    const h = Number(img.getAttribute('height'))
    let sized = (w > 0 && h > 0) || cs.aspectRatio !== 'auto'
    for (let a = img.parentElement, d = 0; !sized && a && d < 4; a = a.parentElement, d++) {
      if (getComputedStyle(a).aspectRatio !== 'auto') sized = true
    }
    if (sized) continue
    const tall = definiteHeight(img)
    const wide = typed(img, 'width') !== 'auto'
    if (tall && wide) continue
    findings.push({
      kind: 'image-size',
      severity: tall ? 'warning' : 'error',
      element: describe(img) + (img.getAttribute('src') ? ` src=${(img.getAttribute('src') || '').slice(0, 60)}` : ''),
      blockId: blockOf(img),
      detail: tall ? 'height fixed but the width follows the file' : 'no width/height attributes and no aspect box',
    })
  }

  return { findings, viewport: vw, docWidth, blocks: document.querySelectorAll('[data-block-id]').length }
}
