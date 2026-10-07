import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '@/components/admin/email-composer/extensions'
import {
  hasComplexMarkup,
  isSafeHref,
  normalizeLinkUrl,
  prepareInputHtml,
  serializeEmailHtml,
} from '@/components/admin/email-composer/html'
import {
  applyLink,
  clearFormatting,
  getLinkState,
  insertCta,
  removeLink,
} from '@/components/admin/email-composer/actions'
import { groupVariables, type ComposerVariable } from '@/components/admin/email-composer/variables'

const editors: Editor[] = []
function make(html = '') {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: buildExtensions('Write…'), content: prepareInputHtml(html) })
  editors.push(editor)
  return editor
}
const out = (e: Editor) => (e.isEmpty ? '' : serializeEmailHtml(e.getHTML()))

function selectText(editor: Editor, needle: string) {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text!.includes(needle)) from = pos + node.text!.indexOf(needle)
  })
  editor.commands.setTextSelection({ from, to: from + needle.length })
}

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

describe('variables', () => {
  it('inserts a variable as a bare {key} with no wrapper', () => {
    const e = make('<p>Hello</p>')
    e.commands.focus('end')
    e.commands.insertContent(' ')
    e.commands.insertVariable('store_name')
    const html = out(e)
    expect(html).toBe('<p>Hello {store_name} </p>')
    expect(html).not.toMatch(/<span/)
    expect(html).not.toMatch(/data-variable|background|a78bfa/)
  })

  it('renders the variable as an atomic chip node in the editor', () => {
    const e = make('<p>Hi {customer_first_name}</p>')
    const chip = e.view.dom.querySelector('[data-variable-chip]') as HTMLElement
    expect(chip).toBeTruthy()
    expect(chip.getAttribute('contenteditable')).toBe('false')
    let atoms = 0
    e.state.doc.descendants(n => {
      if (n.type.name === 'variable') atoms++
    })
    expect(atoms).toBe(1)
  })

  it('typing after a chip never merges text into the token', () => {
    const e = make('<p>{store_name}</p>')
    e.commands.focus('end')
    e.commands.insertContent('abc')
    expect(out(e)).toBe('<p>{store_name}abc</p>')
  })

  it('parses the old styled span token into a chip and back to {key}', () => {
    const legacy =
      '<p>Dear <span style="font-family:ui-monospace,monospace;font-size:13px;border:1px solid #a78bfa;border-radius:3px;padding:1px 4px;color:inherit;">{customer_name}</span>&nbsp;thanks</p>'
    expect(out(make(legacy))).toBe('<p>Dear {customer_name}&nbsp;thanks</p>')
  })

  it('cleans the Chrome-mangled token (background-color baked in, typed text merged in)', () => {
    const mangled =
      '<p style="background:#fff7ed">Code:<span style="color: inherit; background-color: rgb(24, 24, 27); font-family: ui-monospace, monospace; font-size: 13px; border: 1px solid rgb(167, 139, 250); border-radius: 3px; padding: 1px 4px;">{store_name}abc</span></p>'
    const html = out(make(mangled))
    expect(html).toContain('{store_name}abc')
    expect(html).not.toMatch(/rgb\(24, 24, 27\)|a78bfa|167, 139, 250/)
  })

  it('parses {{ key }} double-brace text into a chip that serializes as {key}', () => {
    expect(out(make('<p>Hi {{ customer_first_name }} from {{store_name}}</p>'))).toBe(
      '<p>Hi {customer_first_name} from {store_name}</p>'
    )
  })

  it('leaves tokens inside attributes (href) as text', () => {
    const html = prepareInputHtml('<p><a href="{ctaUrl}">Go {firstName}</a></p>')
    expect(html).toContain('href="{ctaUrl}"')
    expect(html).toContain('<span data-variable="firstName"></span>')
  })

  it('converts a typed {key} into a chip via the input rule', () => {
    const e = make('<p></p>')
    e.commands.focus('end')
    e.commands.insertContent('Hi {store_name')
    // input rules fire on text input, so simulate the closing brace keystroke
    const { from } = e.state.selection
    const handled = e.view.someProp('handleTextInput', f => f(e.view, from, from, '}', () => e.state.tr))
    expect(handled).toBe(true)
    expect(out(e)).toBe('<p>Hi {store_name}</p>')
  })

  it('unwraps block tokens like {itemsHtml} from paragraphs', () => {
    expect(out(make('<p>Hi</p>{itemsHtml}<p>Bye</p>'))).toBe('<p>Hi</p>{itemsHtml}<p>Bye</p>')
  })
})

describe('links', () => {
  it('inserts a new link with text, target=_blank rel=noopener', () => {
    const e = make('<p>See </p>')
    e.commands.focus('end')
    expect(applyLink(e, { url: 'example.com/x', text: 'our site' }).ok).toBe(true)
    expect(out(e)).toContain('<a target="_blank" rel="noopener" href="https://example.com/x">our site</a>')
  })

  it('converts the selected text into a link', () => {
    const e = make('<p>Track your order today</p>')
    selectText(e, 'your order')
    applyLink(e, { url: 'https://shop.test/track' })
    expect(out(e)).toBe(
      '<p>Track <a target="_blank" rel="noopener" href="https://shop.test/track">your order</a> today</p>'
    )
  })

  it('edits and removes an existing link', () => {
    const e = make('<p>Go <a href="https://a.test">here</a> now</p>')
    selectText(e, 'er')
    e.commands.setTextSelection(e.state.selection.from)
    expect(getLinkState(e)).toMatchObject({ inLink: true, href: 'https://a.test', text: 'here' })
    applyLink(e, { url: 'https://b.test', text: 'there' })
    expect(out(e)).toContain('href="https://b.test">there</a>')
    selectText(e, 'her')
    e.commands.setTextSelection(e.state.selection.from)
    removeLink(e)
    expect(out(e)).toBe('<p>Go there now</p>')
  })

  it('rejects javascript: and other unsafe schemes', () => {
    const e = make('<p>x</p>')
    e.commands.focus('end')
    const res = applyLink(e, { url: 'javascript:alert(1)', text: 'x' })
    expect(res.ok).toBe(false)
    expect(normalizeLinkUrl('  JaVa\nScRiPt:alert(1)').ok).toBe(false)
    expect(normalizeLinkUrl('data:text/html,hi').ok).toBe(false)
    expect(out(e)).not.toContain('<a')
    // and stored HTML with a javascript: href loses it on parse
    expect(out(make('<p><a href="javascript:alert(1)">bad</a></p>'))).not.toContain('javascript')
  })

  it('accepts mailto, tel, emails and template tokens', () => {
    expect(normalizeLinkUrl('a@b.co')).toEqual({ ok: true, href: 'mailto:a@b.co' })
    expect(normalizeLinkUrl('tel:+91 90000 00000').ok).toBe(true)
    expect(normalizeLinkUrl('{ctaUrl}')).toEqual({ ok: true, href: '{ctaUrl}' })
    expect(isSafeHref('https://{store_web}/offers')).toBe(true)
    expect(normalizeLinkUrl('not a url').ok).toBe(false)
  })

  it('keeps the CTA button inline styles', () => {
    const e = make('<p>Hi</p>')
    e.commands.focus('end')
    insertCta(e, 'https://shop.test')
    const html = out(e)
    expect(html).toContain('<p style="text-align: center; margin: 24px 0px;">')
    expect(html).toMatch(/<a [^>]*href="https:\/\/shop\.test"[^>]*style="display: inline-block; background: #e07b3f/)
  })
})

describe('inline styles', () => {
  it('serializes alignment, font family, size and colour as inline styles (no classes)', () => {
    const e = make('<p>Hello world</p>')
    e.commands.setTextAlign('center')
    selectText(e, 'world')
    e.chain().setFontFamily('Georgia, serif').setFontSize('20px').setColor('#dc2626').run()
    const html = out(e)
    expect(html).toContain('<p style="text-align: center;">')
    expect(html).toMatch(/<span style="[^"]*color: #dc2626[^"]*">world<\/span>/)
    expect(html).toMatch(/font-family: Georgia, serif/)
    expect(html).toMatch(/font-size: 20px/)
    expect(html).not.toContain('class=')
  })

  it('justify and headings', () => {
    const e = make('<p>Title</p>')
    e.chain().setHeading({ level: 2 }).setTextAlign('justify').run()
    expect(out(e)).toBe('<h2 style="text-align: justify;">Title</h2>')
  })

  it('preserves existing inline block styles from stored templates', () => {
    const src = '<p style="background:#fff7ed;border:1px dashed #e07b3f;text-align:center;">{couponCode}</p>'
    const html = out(make(src))
    expect(html).toContain('text-align: center')
    expect(html).toContain('background: #fff7ed; border: 1px dashed #e07b3f')
    expect(html).toContain('{couponCode}')
  })

  it('clear formatting drops marks, alignment and block styles', () => {
    const e = make('<p style="color:#555;text-align:right"><strong>Bold</strong></p>')
    e.commands.selectAll()
    clearFormatting(e)
    expect(out(e)).toBe('<p>Bold</p>')
  })

  it('keeps an empty paragraph as a visible blank line', () => {
    expect(serializeEmailHtml('<p>a</p><p></p><p>b</p>')).toBe('<p>a</p><p>&nbsp;</p><p>b</p>')
    expect(serializeEmailHtml('<p>a</p><p></p><p></p>')).toBe('<p>a</p>')
  })
})

describe('misc helpers', () => {
  it('detects layout markup the visual editor would flatten', () => {
    expect(hasComplexMarkup('<div style="x"><p>a</p></div>')).toBe(true)
    expect(hasComplexMarkup('<table><tr><td>a</td></tr></table>')).toBe(true)
    expect(hasComplexMarkup('<p>Hi <strong>x</strong></p>')).toBe(false)
  })

  it('groups and searches variables', () => {
    const vars: ComposerVariable[] = [
      { key: 'store_name', label: 'Store name', description: 'd', group: 'store', sample: 'S', builtIn: true },
      { key: 'customer_name', label: 'Full name', description: 'd', group: 'customer', sample: 'A', builtIn: true },
      {
        key: 'firstName',
        label: 'First name',
        description: 'd',
        group: 'customer',
        sample: 'A',
        builtIn: false,
        section: 'Campaign',
      },
    ]
    expect(groupVariables(vars).map(s => s.title)).toEqual(['Store', 'Customer', 'Campaign'])
    expect(groupVariables(vars, 'store').flatMap(s => s.vars.map(v => v.key))).toEqual(['store_name'])
  })
})
