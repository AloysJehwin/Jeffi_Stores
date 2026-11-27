import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '@controller/lib/outreach/agent/skill/frontmatter'

describe('parseFrontmatter', () => {
  it('no frontmatter: empty data and the whole text is the body', () => {
    const r = parseFrontmatter('# Title\n\nHello')
    expect(r).toMatchObject({ data: {}, body: '# Title\n\nHello', bodyLine: 1, issues: [] })
  })

  it('a fence that is not on the very first line is body text', () => {
    expect(parseFrontmatter('\n---\nname: x\n---\n').data).toEqual({})
  })

  it('reads strings, numbers, booleans and null, quoted or bare', () => {
    const r = parseFrontmatter(['---', 'a: hello world', 'b: "quoted: value"', "c: 'it''s'", 'd: 42', 'e: 1.5', 'f: true', 'g: false', 'h: null', 'i: ~', 'j:', '---', 'body'].join('\n'))
    expect(r.issues).toEqual([])
    expect(r.data).toEqual({ a: 'hello world', b: 'quoted: value', c: "it's", d: 42, e: 1.5, f: true, g: false, h: null, i: null, j: null })
    expect(r.body).toBe('body')
    expect(r.bodyLine).toBe(13)
  })

  it('strips comments but not # inside quotes or glued to a word', () => {
    const r = parseFrontmatter(['---', '# a comment line', 'name: showcase   # the slug', 'tone: "warm # not a comment"', 'tag: a#b', '---'].join('\n'))
    expect(r.data).toEqual({ name: 'showcase', tone: 'warm # not a comment', tag: 'a#b' })
  })

  it('inline lists, including quoted items with commas and the empty list', () => {
    const r = parseFrontmatter(['---', 'channels: [voice, whatsapp]', 'odd: ["a, b", c, 3]', 'none: []', '---'].join('\n'))
    expect(r.data).toEqual({ channels: ['voice', 'whatsapp'], odd: ['a, b', 'c', 3], none: [] })
  })

  it('dash lists', () => {
    const r = parseFrontmatter(['---', 'tools:', '  - addDetails', '  - requestChange # why', '  - "optOut"', 'next: 1', '---'].join('\n'))
    expect(r.data).toEqual({ tools: ['addDetails', 'requestChange', 'optOut'], next: 1 })
  })

  it('one level of nested map, with scalar and list values', () => {
    const r = parseFrontmatter(['---', 'persona:', '  en: Priya', '  hi: "Priya"', 'tools:', '  voice: [a, b]', '  follow_up: [c]', 'limits:', '  max_agent_calls: 2', '---'].join('\n'))
    expect(r.issues).toEqual([])
    expect(r.data).toEqual({ persona: { en: 'Priya', hi: 'Priya' }, tools: { voice: ['a', 'b'], follow_up: ['c'] }, limits: { max_agent_calls: 2 } })
  })

  it('handles CRLF and a BOM', () => {
    const r = parseFrontmatter('﻿---\r\nname: x\r\n---\r\nbody\r\n')
    expect(r.data).toEqual({ name: 'x' })
    expect(r.body).toBe('body\n')
  })

  it('reports an unclosed fence on line 1', () => {
    const r = parseFrontmatter('---\nname: x\nno end')
    expect(r.issues).toEqual([expect.objectContaining({ level: 'error', code: 'frontmatter_unclosed', line: 1 })])
    expect(r.data).toEqual({})
  })

  it('reports syntax problems with line numbers and keeps reading', () => {
    const r = parseFrontmatter(['---', 'name: ok', 'this is not a pair', 'list: [a, b', 'quote: "oops', '  stray: 1', 'deep:', '  a:', '    b: 1', '---'].join('\n'))
    expect(r.data.name).toBe('ok')
    const by = Object.fromEntries(r.issues.map(i => [i.code + ':' + i.line, i.level]))
    expect(by['frontmatter_syntax:3']).toBe('error')
    expect(by['frontmatter_value:4']).toBe('error')
    expect(by['frontmatter_value:5']).toBe('error')
    expect(by['frontmatter_indent:6']).toBe('error')
    expect(Object.keys(by).some(k => k.startsWith('frontmatter_nested'))).toBe(true)
  })

  it('warns on a duplicate key and the last one wins', () => {
    const r = parseFrontmatter('---\na: 1\na: 2\n---')
    expect(r.data.a).toBe(2)
    expect(r.issues).toEqual([expect.objectContaining({ level: 'warning', code: 'frontmatter_duplicate', line: 3 })])
  })

  it('a non-dash line inside a dash list is an error', () => {
    const r = parseFrontmatter('---\ntools:\n  - a\n  b\n---')
    expect(r.issues.some(i => i.code === 'frontmatter_list' && i.line === 4)).toBe(true)
  })
})
