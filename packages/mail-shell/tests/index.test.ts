import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  mailShell,
  applyMailTheme,
  MAIL_BASE_CSS,
  REPLY_HINT,
  type MailShellOptions,
} from '../src/index.ts'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant chars', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
  it('escapes & first so entities are not double-escaped wrong', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })
  it('coerces null/undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
  it('stringifies non-string values', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(true)).toBe('true')
  })
})

const base: MailShellOptions = { brand: 'Acme', content: '<p>Hi</p>' }

describe('mailShell — structure & defaults', () => {
  it('wraps content in the document shell with the base CSS', () => {
    const html = mailShell(base)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain(MAIL_BASE_CSS)
    expect(html).toContain('<p>Hi</p>')
    // Brand appears in bold in the footer and in the header div.
    expect(html).toContain('<strong>Acme</strong>')
    expect(html).toContain('class="brand"')
  })

  it('escapes the brand name', () => {
    const html = mailShell({ ...base, brand: '<Acme & Co>' })
    expect(html).toContain('&lt;Acme &amp; Co&gt;')
    expect(html).not.toContain('<Acme & Co>')
  })

  it('applies the default blue accent when no theme is given', () => {
    const html = mailShell(base)
    expect(html).toContain('color:#2563eb')
    expect(html).toContain('.brand { color:#2563eb; }')
  })

  it('marks an unthemed mail so applyMailTheme can retheme it', () => {
    const html = mailShell(base)
    expect(html).toContain('<!--mail-brand-->')
    expect(html).toContain('<!--/mail-brand-->')
    expect(html).toContain('<!--mail-footer-->')
    expect(html).toContain('<!--/mail-footer-->')
  })

  it('does NOT emit the retheme markers when an explicit theme is passed', () => {
    const html = mailShell({ ...base, theme: { accent: '#ff0000' } })
    expect(html).not.toContain('<!--mail-brand-->')
    expect(html).not.toContain('<!--mail-footer-->')
  })
})

describe('mailShell — optional fields', () => {
  it('omits title/kicker/preheader/documentTitle when absent', () => {
    const html = mailShell(base)
    expect(html).not.toContain('<h2>')
    expect(html).not.toContain('class="kicker"')
    expect(html).not.toContain('<title>')
    // Preheader hidden span absent.
    expect(html).not.toContain('mso-hide:all')
  })

  it('renders and escapes title, kicker, preheader, documentTitle', () => {
    const html = mailShell({
      ...base,
      title: 'Order <42>',
      kicker: 'Thanks & bye',
      preheader: 'pre "head"',
      documentTitle: 'Doc <x>',
    })
    expect(html).toContain('<h2>Order &lt;42&gt;</h2>')
    expect(html).toContain('class="kicker"')
    expect(html).toContain('Thanks &amp; bye')
    expect(html).toContain('mso-hide:all')
    expect(html).toContain('pre &quot;head&quot;')
    expect(html).toContain('<title>Doc &lt;x&gt;</title>')
  })

  it('appends extraCss after the theme CSS', () => {
    const html = mailShell({ ...base, extraCss: '.foo{color:red}' })
    expect(html).toContain('.foo{color:red}')
    // extraCss sits after the themeCss block, inside the same <style>.
    expect(html.indexOf('.foo{color:red}')).toBeGreaterThan(html.indexOf('.brand { color:'))
  })
})

describe('mailShell — footer', () => {
  it('drops falsy footer lines and renders the truthy ones', () => {
    const html = mailShell({ ...base, footerLines: ['Line A', '', 'Line B'] })
    expect(html).toContain('<p>Line A</p>')
    expect(html).toContain('<p>Line B</p>')
    // No empty <p></p> from the dropped blank line.
    expect(html).not.toContain('<p></p>')
  })

  it('adds the reply hint line only when replyHint is set', () => {
    expect(mailShell(base)).not.toContain(REPLY_HINT)
    expect(mailShell({ ...base, replyHint: true })).toContain(REPLY_HINT)
  })
})

describe('mailShell — theme handling', () => {
  it('honours a full custom theme (accent, bg, full frame, left align)', () => {
    const html = mailShell({
      ...base,
      theme: { accent: '#123456', pageBg: '#000', containerBg: '#111', frame: 'full', headerAlign: 'left' },
    })
    expect(html).toContain('background:#000;')
    expect(html).toContain('.container { background-color:#111;')
    // 'full' frame zeroes radius/border/padding.
    expect(html).toContain('border-radius:0;border:none;padding:0;')
    expect(html).toContain('.header { text-align:left; }')
    expect(html).toContain('.code-box, .button { background-color:#123456; }')
  })

  it('card frame leaves the container frame CSS empty', () => {
    const html = mailShell({ ...base, theme: { frame: 'card' } })
    expect(html).not.toContain('border-radius:0;border:none;padding:0;')
  })

  it('merges a partial theme over the defaults', () => {
    const html = mailShell({ ...base, theme: { accent: '#abcdef' } })
    // Overridden accent but default backgrounds.
    expect(html).toContain('.brand { color:#abcdef; }')
    expect(html).toContain('background:#ffffff;')
    expect(html).toContain('.container { background-color:#f9f9f9;')
  })
})

describe('applyMailTheme', () => {
  it('returns non-mailShell HTML unchanged (no marker)', () => {
    const raw = '<html><body>plain</body></html>'
    expect(applyMailTheme(raw, { accent: '#ff0000' })).toBe(raw)
  })

  it('recolours a default-themed mail when accent is a valid hex', () => {
    const html = mailShell(base) // contains <!--mail-brand-->
    const out = applyMailTheme(html, { accent: '#ff0000' })
    // Brand div colour swapped.
    expect(out).toContain('color:#ff0000')
    // Injected override <style> before </head>.
    expect(out).toContain('.code-box,.button{background-color:#ff0000 !important}')
    expect(out).toContain('.info{border-left-color:#ff0000 !important}')
    expect(out).toContain('a{color:#ff0000}')
  })

  it('ignores an invalid / missing accent (no override style)', () => {
    const html = mailShell(base)
    for (const accent of ['red', '#fff', '#12345', undefined, null]) {
      const out = applyMailTheme(html, { accent: accent as any })
      expect(out).not.toContain('!important}')
    }
  })

  it('adds the reply line when replyHint set and not already present', () => {
    const html = mailShell(base)
    const out = applyMailTheme(html, { replyHint: true })
    expect(out).toContain(REPLY_HINT)
    // Inserted just inside the footer marker.
    expect(out).toContain(`<p>${REPLY_HINT}</p><!--/mail-footer-->`)
  })

  it('does not duplicate the reply line if the mail already carries it', () => {
    const html = mailShell({ ...base, replyHint: true }) // already has REPLY_HINT
    const out = applyMailTheme(html, { replyHint: true })
    const count = out.split(REPLY_HINT).length - 1
    expect(count).toBe(1)
  })

  it('applies both accent and reply hint together', () => {
    const html = mailShell(base)
    const out = applyMailTheme(html, { accent: '#00ff00', replyHint: true })
    expect(out).toContain('background-color:#00ff00 !important')
    expect(out).toContain(REPLY_HINT)
  })
})
