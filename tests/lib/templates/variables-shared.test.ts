import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  findTokenKeys,
  stripDoubleBraceTokens,
  TOKEN_RE,
  BUILTIN_TEMPLATE_VARIABLES,
  sampleVariableMap,
} from '@/lib/templates/variables-shared'

const vars = { store_name: 'Acme Tools', customer_first_name: 'Asha', store_phone: '' }

describe('renderTemplate', () => {
  it('substitutes single-brace tokens', () => {
    expect(renderTemplate('Hi {customer_first_name} from {store_name}', vars)).toBe('Hi Asha from Acme Tools')
  })

  it('substitutes double-brace tokens', () => {
    expect(renderTemplate('{{store_name}} / {{ store_name }}', vars)).toBe('Acme Tools / Acme Tools')
  })

  it('tolerates whitespace inside single braces', () => {
    expect(renderTemplate('{ store_name }', vars)).toBe('Acme Tools')
  })

  it('is case-insensitive on the key', () => {
    expect(renderTemplate('{Store_Name} {{STORE_NAME}}', vars)).toBe('Acme Tools Acme Tools')
  })

  it('prefers an exact-case key (camelCase scenario vars)', () => {
    expect(renderTemplate('{firstName}', { firstName: 'Ravi', firstname: 'x' })).toBe('Ravi')
  })

  it('unwraps the legacy editor chip span so no styling is mailed', () => {
    const html =
      '<p>Hi <span style="font-family:ui-monospace,monospace;font-size:13px;border:1px solid #a78bfa;">{customer_first_name}</span>&nbsp;!</p>'
    expect(renderTemplate(html, vars)).toBe('<p>Hi Asha&nbsp;!</p>')
  })

  it('replaces a data-variable chip with its value', () => {
    const html = '<p><span data-variable="store_name" class="chip" contenteditable="false">Store name</span></p>'
    expect(renderTemplate(html, vars)).toBe('<p>Acme Tools</p>')
  })

  it('handles entity-encoded braces and &nbsp; inside the token', () => {
    expect(renderTemplate('&#123;store_name&#125;', vars)).toBe('Acme Tools')
    expect(renderTemplate('{{&nbsp;store_name&nbsp;}}', vars)).toBe('Acme Tools')
    expect(renderTemplate('&lbrace;&lbrace;store_name&rbrace;&rbrace;', vars)).toBe('Acme Tools')
  })

  it('handles a token split by editor tags, keeping the tags balanced', () => {
    expect(renderTemplate('<b>{store_</b>name}', vars)).toBe('<b>Acme Tools</b>')
    expect(renderTemplate('{<span style="color:red">store_name</span>}', vars)).toBe(
      'Acme Tools<span style="color:red"></span>'
    )
  })

  it('leaves unknown tokens untouched', () => {
    expect(renderTemplate('{unknown} {{other_thing}} <span style="x">{nope}</span>', vars)).toBe(
      '{unknown} {{other_thing}} <span style="x">{nope}</span>'
    )
  })

  it('renders a registered-but-empty value as empty', () => {
    expect(renderTemplate('Call {store_phone}.', vars)).toBe('Call .')
  })

  it('escapes values only when asked', () => {
    const v = { store_name: 'Tools & <More>' }
    expect(renderTemplate('{store_name}', v)).toBe('Tools & <More>')
    expect(renderTemplate('{store_name}', v, { escape: true })).toBe('Tools &amp; &lt;More&gt;')
  })

  it('does not touch CSS blocks', () => {
    const css = 'body{visibility:hidden} .a { color:#fff; }'
    expect(renderTemplate(css, { visibility: 'X', color: 'Y' })).toBe(css)
  })

  it('returns empty input unchanged', () => {
    expect(renderTemplate('', vars)).toBe('')
  })
})

describe('TOKEN_RE', () => {
  it('matches both syntaxes', () => {
    const m = [...'{a} {{ b_c }} {Xy}'.matchAll(TOKEN_RE)].map(x => x[1] || x[2])
    expect(m).toEqual(['a', 'b_c', 'Xy'])
  })
})

describe('findTokenKeys / stripDoubleBraceTokens', () => {
  it('finds keys in every form, lower-cased', () => {
    expect(findTokenKeys('{Store_Name} {{ customer_email }} &#123;date&#125;').sort()).toEqual([
      'customer_email',
      'date',
      'store_name',
    ])
  })

  it('blanks only double-brace tokens', () => {
    expect(stripDoubleBraceTokens('{{x}} {y}')).toBe(' {y}')
  })
})

describe('built-in registry', () => {
  it('has a sample for every built-in', () => {
    const s = sampleVariableMap()
    for (const v of BUILTIN_TEMPLATE_VARIABLES) {
      expect(v.builtIn).toBe(true)
      expect(s[v.key]).toBeDefined()
    }
  })
})
