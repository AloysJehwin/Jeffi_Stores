import { describe, it, expect } from 'vitest'
import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { handEdited, pageWords } from '@/lib/site/studio/keep-words'
import { briefText, tweakUser } from '@/lib/site/studio/prompts'

// "Keep my words": the words on a page changed by hand go to the AI with the brief when it is designed again.

const t = (...words: string[]): CodeNode => ({ t: 'el', tag: 'section', props: {}, id: 'e1', children: words.map((w, i) => ({ t: 'text', value: w, id: `e1.${i}` })) })
const page = (over: Partial<PageDoc['blocks']> = {}): PageDoc => ({
  schemaVersion: 1,
  order: ['a', 'b', 'c'],
  blocks: {
    a: { id: 'a', type: 'code_section', v: 1, props: { tree: t('Chai, brewed slow', '  ', 'Order now') } },
    b: { id: 'b', type: 'code_section', v: 1, props: { compiled: { ast: t('Order now', 'Since 1998') } }, visibility: { hidden: false } },
    c: { id: 'c', type: 'code_section', v: 1, props: { tree: t('Hidden words') }, visibility: { hidden: true } },
    ...over,
  } as PageDoc['blocks'],
})
const brief = { storeName: 'Chai Co', summary: '', category: 'tea', audience: '', priceTier: 'mid', voice: '', vocabulary: [], mood: '', artDirection: '', references: [], logoUrl: null, seed: 1 } as never
const direction = { name: 'D', layoutFeel: '', theme: { primary: '#000', accent: '#000', neutral: '#000', fontDisplay: 'A', fontBody: 'B', radius: 'md' } } as never

describe('keep my words', () => {
  it('collects a page’s words in order, once each, leaving hidden sections out', () => {
    expect(pageWords(page())).toEqual(['Chai, brewed slow', 'Order now', 'Since 1998'])
    expect(pageWords(null)).toEqual([])
    expect(pageWords({ schemaVersion: 1, order: ['x'], blocks: { x: { id: 'x', type: 'code_section', v: 1, props: { tree: t(...Array.from({ length: 80 }, (_, i) => `Line ${i}`)) } } } })).toHaveLength(40)
  })

  it('tells a page changed in the visual editor', () => {
    expect(handEdited(page())).toBe(true)
    expect(handEdited({ schemaVersion: 1, order: ['b'], blocks: { b: page().blocks.b } })).toBe(false)
  })

  it('gives the kept words to the section writer, not to section changes', () => {
    const kept = { ...(brief as object), keepWords: ['Chai, brewed slow'] } as never
    expect(briefText(kept)).toContain('reuse them as written where they fit')
    expect(briefText(brief)).not.toContain('reuse them as written')
    expect(tweakUser(kept, direction, 'Hero', 'export default function Section() { return <div /> }', 'x')).not.toContain('Chai, brewed slow')
  })
})
