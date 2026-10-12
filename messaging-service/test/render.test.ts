import { describe, it, expect } from 'vitest'
import { render, missingKeys } from '../src/render.js'
import { messagePriceInr, withMargin } from '@jeffi/pricing'

describe('render', () => {
  it('substitutes both token syntaxes, case-insensitively, and escapes html when asked', () => {
    expect(render('Hi {{Name}}, code {code}', { name: 'A<b>', code: 1 })).toBe('Hi A<b>, code 1')
    expect(render('<p>{{name}}</p>', { name: 'A<b>' }, true)).toBe('<p>A&lt;b&gt;</p>')
    expect(render('{{missing}}', {})).toBe('{{missing}}')
  })
  it('reports missing keys', () => {
    expect(missingKeys('{{a}} {{b}}', { a: 1 })).toEqual(['b'])
  })
})

describe('pricing', () => {
  it('applies the 40% public margin', () => {
    expect(withMargin(7)).toBe(9.8)
    expect(messagePriceInr('email')).toBe(0.07)
  })
})
