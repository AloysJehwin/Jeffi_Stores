import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, type CodeNode } from '@jeffi/site-blocks'
import { applyOps } from '@jeffi/site-blocks/design'
import { colourOf, contrastOf, critiqueTrees } from '@/lib/site/code/tree-critique'

// The critique on code sections' trees: what it finds, and fixes that come back as design operations.

const lit = (v: string) => ({ k: 'lit' as const, v })
const el = (id: string, tag: string, cls: string, kids: CodeNode[] = [], props: Record<string, ReturnType<typeof lit>> = {}): CodeNode => ({ t: 'el', tag, props: { ...(cls ? { className: lit(cls) } : {}), ...props }, children: kids, id })
const words = (id: string, v: string): CodeNode => ({ t: 'text', value: v, id })

const hero = el('e1', 'section', 'bg-primary-900', [
  el('e2', 'h1', 'text-primary-800', [words('e2.0', 'Welcome')]),
  el('e3', 'p', '', [words('e3.0', 'Fine print '.repeat(50))]),
  { t: 'cmp', name: 'Image', props: { src: lit('https://cdn.example.com/a.jpg'), alt: lit('') }, children: [], id: 'e4' },
  el('e5', 'h4', '', [words('e5.0', 'Too deep')]),
  el('e6', 'div', 'absolute left-[80%] top-[0%] w-[40%]', [words('e6.0', 'Badge')]),
])
const second = el('e1', 'section', '', [el('e2', 'h1', '', [words('e2.0', 'Again')])])

describe('tree critique', () => {
  const found = critiqueTrees(
    [
      { block: 'a', label: 'Hero', tree: hero },
      { block: 'b', label: 'Story', tree: second },
    ],
    DEFAULT_THEME
  )
  const by = (code: string) => found.filter(f => f.code === code)

  it('reads theme and hex colours', () => {
    expect(colourOf('white', DEFAULT_THEME)).toBe('#ffffff')
    expect(colourOf('[#abc]', DEFAULT_THEME)).toBe('#aabbcc')
    expect(colourOf('primary-500/50', DEFAULT_THEME)).toMatch(/^#/)
    expect(colourOf('gray-500', DEFAULT_THEME)).toBeNull()
    expect(contrastOf('#ffffff', '#000000')).toBeCloseTo(21)
  })

  it('finds pale words, long words, undescribed pictures, skipped headings and off-screen layers', () => {
    expect(by('contrast').map(f => f.id)).toEqual(['e2', 'e3', 'e5', 'e6'])
    expect(by('too_long').map(f => f.id)).toEqual(['e3'])
    expect(by('no_alt').map(f => f.id)).toEqual(['e4'])
    expect(by('heading_order').map(f => [f.block, f.id])).toEqual([
      ['a', 'e5'],
      ['b', 'e2'],
    ])
    expect(by('off_screen').map(f => f.id)).toEqual(['e6'])
  })

  it('fixes them as design operations', () => {
    const apply = (code: string, id: string, tree: CodeNode) => {
      const f = found.find(x => x.code === code && x.id === id)!
      expect(f.fix && 'ops' in f.fix).toBe(true)
      return applyOps(tree, (f.fix as { ops: never[] }).ops).tree
    }
    expect(JSON.stringify(apply('contrast', 'e2', hero))).toContain('"text-white"')
    expect(JSON.stringify(apply('no_alt', 'e4', hero))).toContain('"alt":{"k":"lit","v":"Welcome"}')
    expect(JSON.stringify(apply('heading_order', 'e5', hero))).toContain('"tag":"h2"')
    expect(JSON.stringify(apply('off_screen', 'e6', hero))).toContain('left-[60%]')
    expect(by('too_long')[0].fix).toEqual({ shorten: { fieldId: 'e3', text: expect.stringContaining('Fine print') } })
  })

  it('finds nothing on a sound section', () => {
    const ok = el('e1', 'section', 'bg-surface', [el('e2', 'h2', 'text-foreground', [words('e2.0', 'Fine')]), { t: 'cmp', name: 'Image', props: { src: lit('https://x.example.com/a.jpg'), alt: lit('Tea') }, children: [], id: 'e3' }])
    expect(critiqueTrees([{ block: 'a', label: 'A', tree: ok }], DEFAULT_THEME)).toEqual([])
  })
})
