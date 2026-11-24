import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/ai-client', () => ({ aiChat: vi.fn() }))

import { DEFAULT_THEME, type CodeNode, type PageDoc } from '@jeffi/site-blocks'
import { critiquePage, offScreenOnPhones } from '@/lib/site/critique'

// The critique on free layers: one placed on phones (base classes) past the section's edges is reported; placed only
// on wider screens, it sits in the flow on phones and can't fall off.

const el = (id: string, cls: string): CodeNode => ({ t: 'el', tag: 'div', props: { className: { k: 'lit', v: cls } }, children: [], id })
const ast: CodeNode = {
  t: 'el',
  tag: 'section',
  props: { className: { k: 'lit', v: 'relative' } },
  id: 'e1',
  children: [
    el('e2', 'absolute left-[70%] top-[10%] w-[50%] z-10'),
    el('e3', 'absolute left-[10%] top-[10%] w-[50%] z-10'),
    el('e4', 'lg:absolute lg:left-[80%] lg:top-[0%] lg:w-[60%] lg:z-10'),
    el('e5', 'absolute -left-[5%] top-[0%] w-[20%]'),
    el('e6', 'absolute left-[0%] top-[90%] w-[20%] h-[20%]'),
  ],
}

describe('critique of free layers', () => {
  it('finds layers that run off a phone screen', () => {
    expect(offScreenOnPhones(ast)).toEqual(['e2', 'e5', 'e6'])
    expect(offScreenOnPhones(null)).toEqual([])
  })

  it('reports them on the page, per element', async () => {
    const doc: PageDoc = { schemaVersion: 1, order: ['a'], blocks: { a: { id: 'a', type: 'code_section', v: 1, props: { label: 'Hero', source: '', compiled: { id: 'cs', ast } } } } }
    const found = (await critiquePage(doc, { audience: 'store', surface: 'web', page: 'home' }, DEFAULT_THEME)).filter(f => f.code === 'off_screen')
    expect(found.map(f => f.blockId)).toEqual(['a#e2', 'a#e5', 'a#e6'])
    expect(found[0]).toMatchObject({ severity: 'warn', fixable: false })
    expect(found[0].message).toContain('"Hero"')
  })
})
