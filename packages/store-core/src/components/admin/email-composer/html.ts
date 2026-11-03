// Pure helpers shared by the composer and its tests: legacy-token parsing, email-safe output, link
// validation. Kept free of Tiptap imports so they can be unit-tested without an editor.

export const VAR_KEY = '[A-Za-z_][A-Za-z0-9_]*'
// `{key}` or `{{ key }}`, whitespace tolerant inside the double form.
export const TOKEN_PATTERN = new RegExp(`\\{\\{\\s*(${VAR_KEY})\\s*\\}\\}|\\{(${VAR_KEY})\\}`, 'g')

// Tokens that expand to block HTML (tables) at send time; never leave them wrapped in a <p>.
const BLOCK_TOKEN = /^(?:itemsHtml|cartItems|productCard|\w+Html)$/

export function chipHtml(key: string): string {
  return `<span data-variable="${key}"></span>`
}

function isLegacyChipSpan(el: Element): boolean {
  if (el.hasAttribute('data-variable')) return false
  const style = (el.getAttribute('style') || '').toLowerCase()
  const looksLikeChip = style.includes('a78bfa') || (style.includes('monospace') && style.includes('border'))
  if (!looksLikeChip) return false
  TOKEN_PATTERN.lastIndex = 0
  return TOKEN_PATTERN.test(el.textContent || '')
}

/**
 * Turn stored HTML into editor input: legacy styled token spans are unwrapped and every `{key}` /
 * `{{key}}` in text (never in attributes such as href) becomes a variable chip placeholder.
 */
export function prepareInputHtml(html: string): string {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
  const body = doc.body

  for (const span of Array.from(body.querySelectorAll('span'))) {
    if (isLegacyChipSpan(span)) span.replaceWith(...Array.from(span.childNodes))
  }

  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
  for (const text of texts) {
    const parent = text.parentElement
    if (!parent || parent.closest('[data-variable],style,script,textarea')) continue
    const value = text.data
    TOKEN_PATTERN.lastIndex = 0
    if (!TOKEN_PATTERN.test(value)) continue
    TOKEN_PATTERN.lastIndex = 0
    const frag = doc.createDocumentFragment()
    let last = 0
    for (let m = TOKEN_PATTERN.exec(value); m; m = TOKEN_PATTERN.exec(value)) {
      if (m.index > last) frag.append(value.slice(last, m.index))
      const chip = doc.createElement('span')
      chip.setAttribute('data-variable', m[1] || m[2])
      frag.append(chip)
      last = m.index + m[0].length
    }
    if (last < value.length) frag.append(value.slice(last))
    text.replaceWith(frag)
  }
  return body.innerHTML
}

/** Final pass on editor HTML before it leaves the composer. */
export function serializeEmailHtml(html: string): string {
  return (
    html
      .replace(/<span data-variable="([^"]+)"[^>]*>[^<]*<\/span>/g, '{$1}')
      .replace(/<p>\s*\{([A-Za-z_]\w*)\}\s*<\/p>/g, (m, key: string) => (BLOCK_TOKEN.test(key) ? `{${key}}` : m))
      .replace(/(?:<p[^>]*>(?:\s|&nbsp;|<br>)*<\/p>)+$/, '')
      // Email clients collapse empty paragraphs; keep the blank line the author typed.
      .replace(/<p([^>]*)><\/p>/g, '<p$1>&nbsp;</p>')
  )
}

const UNSAFE_SCHEME = /^\s*(?:javascript|data|vbscript|file):/i

/** Hrefs allowed in the schema: http(s)/mailto/tel, or a template token such as `{ctaUrl}`. */
export function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false
  const raw = href.trim()
  // Browsers ignore control chars/whitespace inside schemes ("java\nscript:").
  const squashed = raw.replace(/[\u0000- ]/g, '')
  if (UNSAFE_SCHEME.test(squashed)) return false
  const probe = raw.replace(TOKEN_PATTERN, 'x')
  if (/^\{[^}]+\}$/.test(raw) || /^\{\{[^}]+\}\}$/.test(raw)) return true
  if (/^(?:https?:\/\/)[^\s]+$/i.test(probe)) return true
  if (/^mailto:[^\s]+$/i.test(probe)) return true
  if (/^tel:[+\d][\d\s().-]*$/i.test(probe)) return true
  return false
}

export type LinkCheck = { ok: true; href: string } | { ok: false; error: string }

/** Validate what a user typed in the link dialog; bare domains get https://. */
export function normalizeLinkUrl(input: string): LinkCheck {
  const raw = input.trim()
  if (!raw || raw === 'https://') return { ok: false, error: 'Enter a URL' }
  if (UNSAFE_SCHEME.test(raw.replace(/[\u0000- ]/g, ''))) {
    return { ok: false, error: 'That link type is not allowed in email' }
  }
  let href = raw
  if (/^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(raw)) href = `mailto:${raw}`
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^\{/.test(raw)) href = `https://${raw.replace(/^\/\//, '')}`
  if (!isSafeHref(href)) return { ok: false, error: 'Use an http(s), mailto: or tel: link' }
  if (/^https?:\/\//i.test(href) && !/^https?:\/\/(?:\{[^}]+\}|[^\s/.]+\.[^\s]+|localhost)/i.test(href)) {
    return { ok: false, error: 'That does not look like a web address' }
  }
  return { ok: true, href }
}

// Markup the visual editor would drop or flatten (layout tables, wrappers, images...).
const COMPLEX_TAG =
  /<(?:table|tbody|thead|tr|td|th|div|img|center|font|section|article|header|footer|style|iframe|video|form|input|button)\b/i

export function hasComplexMarkup(html: string): boolean {
  return COMPLEX_TAG.test(html || '')
}

/** Drop the given CSS properties from an inline style string; null when nothing is left. */
export function stripStyleProps(style: string | null, props: string[]): string | null {
  if (!style) return null
  const kept = style
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(decl => !props.includes(decl.split(':')[0].trim().toLowerCase()))
  return kept.length ? kept.join('; ') : null
}
