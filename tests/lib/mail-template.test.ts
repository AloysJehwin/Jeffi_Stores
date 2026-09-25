import { describe, it, expect } from 'vitest'
import { mailShell, escapeHtml, MAIL_BASE_CSS } from '@/lib/mail-template'

describe('mailShell', () => {
  it('wraps content in the standard container, brand header and footer', () => {
    const html = mailShell({ brand: 'Jeffi Stores', kicker: 'Order Update', title: 'Your order shipped', content: '<p>Body</p>' })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('background-color: #f9f9f9')
    expect(html).toContain('font-size:28px;font-weight:bold;color:#2563eb;letter-spacing:0.5px;">Jeffi Stores</div>')
    expect(html).toContain('<p class="kicker" style="color:#666;">Order Update</p>')
    expect(html).toContain('<h2>Your order shipped</h2>')
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain('<div class="footer">')
    expect(html).toContain('<p><strong>Jeffi Stores</strong></p>')
    expect(html).toContain('border-top: 1px solid #e0e0e0')
  })

  it('escapes brand, kicker, title and preheader but not content', () => {
    const html = mailShell({ brand: 'A & B <Co>', kicker: '"quoted"', title: "it's", content: '<b>raw</b>', preheader: '<hidden>' })
    expect(html).toContain('A &amp; B &lt;Co&gt;')
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).toContain('it&#39;s')
    expect(html).toContain('<b>raw</b>')
    expect(html).toContain('&lt;hidden&gt;')
    expect(html).not.toContain('<hidden>')
  })

  it('appends footer lines and mail-specific css, and omits empty optional parts', () => {
    const html = mailShell({ brand: 'S', content: '', footerLines: ['Line one', '', 'Line <a href="x">two</a>'], extraCss: '.badge { color: red; }' })
    expect(html).toContain('<p>Line one</p>')
    expect(html).toContain('<p>Line <a href="x">two</a></p>')
    expect(html).not.toContain('<p></p>')
    expect(html).toContain('.badge { color: red; }')
    expect(html).toContain(MAIL_BASE_CSS)
    expect(html).not.toContain('<h2>')
    expect(html).not.toContain('class="kicker"')
    expect(html).not.toContain('<title>')
    expect(html).toContain('<meta name="color-scheme" content="light">')
  })

  it('renders an escaped document title when given', () => {
    expect(mailShell({ brand: 'S', content: '', documentTitle: 'Order <42>' })).toContain('<title>Order &lt;42&gt;</title>')
  })

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(42)).toBe('42')
  })
})
