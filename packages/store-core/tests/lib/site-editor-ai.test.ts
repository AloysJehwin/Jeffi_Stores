import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
const tweak = vi.hoisted(() => vi.fn())
vi.mock('@/lib/site/studio/generate', () => ({ tweakSection: tweak }))

import type { CodeNode } from '@jeffi/site-blocks'
import { printSection } from '@/lib/site/code/print'
import { changeSelection, changedIds, selectionAsk } from '@/lib/site/studio/selection'
import { EDITOR_RULES, tweakUser } from '@/lib/site/studio/prompts'

// "Change with AI" on the visual editor's selection: the section printed with its ids, the selection named, the reply
// read back as a tree, and the nodes it changed told apart from those it kept.

const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const tree: CodeNode = {
  t: 'el',
  tag: 'section',
  props: { className: { k: 'lit', v: 'py-16' } },
  id: 'e1',
  children: [
    { t: 'el', tag: 'h2', props: {}, id: 'e2', children: [text('e2.0', 'Old heading')] },
    { t: 'el', tag: 'p', props: {}, id: 'e3', children: [text('e3.0', 'Copy')] },
  ],
}
const ctx = { brief: {}, plan: { pages: [] }, direction: {} } as never

describe('change with AI on a selection', () => {
  it('names the selected elements, or asks for the whole section', () => {
    expect(selectionAsk(tree, ['e2'], 'Make it punchier')).toBe('The owner selected <h2 data-e="e2"> ("Old heading"). Change that element and what is inside as they ask, and leave the rest of the section as it is unless the request needs more: Make it punchier')
    expect(selectionAsk(tree, ['e1'], 'Darker')).toBe('Darker')
    expect(selectionAsk(tree, [], 'Darker')).toBe('Darker')
  })

  it('tells changed and new nodes from kept ones', () => {
    const after: CodeNode = { ...tree, children: [{ ...(tree as { children: CodeNode[] }).children[0], children: [text('e2.0', 'New heading')] } as CodeNode, (tree as { children: CodeNode[] }).children[1], { t: 'el', tag: 'a', props: {}, id: 'e4', children: [] }] } as CodeNode
    expect(changedIds(tree, after)).toEqual(['e1', 'e2', 'e4'])
    expect(changedIds(tree, tree)).toEqual([])
  })

  it('sends the printed section with its ids and reads the reply back as a tree', async () => {
    tweak.mockImplementation(async (_ctx, block: { props: { source: string } }, ask: string) => {
      expect(block.props.source).toContain('data-e="e2"')
      expect(ask).toContain('data-e="e2"')
      return { props: { source: block.props.source.replace('Old heading', 'Fresh heading') } }
    })
    const r = await changeSelection(ctx, { label: 'Hero', tree, page: 'home', ids: ['e2'], instruction: 'Fresher' })
    expect(r.changed).toEqual(['e2'])
    expect(JSON.stringify(r.tree)).toContain('Fresh heading')
    tweak.mockResolvedValue({ props: { source: 'not tsx' } })
    await expect(changeSelection(ctx, { label: 'Hero', tree, page: 'home', ids: [], instruction: 'x' })).rejects.toThrow()
  })

  it('adds the editor rules to the AI prompt only for a section the editor opened', () => {
    const b = { storeName: 'Test', summary: '', category: '', audience: '', priceTier: '', voice: '', vocabulary: [], mood: '', artDirection: '' } as never
    const d = { name: 'D', layoutFeel: '', theme: { primary: '#000', accent: '#000', neutral: '#000', fontDisplay: 'A', fontBody: 'B', radius: 'md' } } as never
    expect(tweakUser(b, d, 'Hero', printSection(tree), 'x')).toContain(EDITOR_RULES)
    expect(tweakUser(b, d, 'Hero', 'export default function Section() { return <div /> }', 'x')).not.toContain('data-e attribute')
    expect(EDITOR_RULES).toMatch(/relative section/)
  })
})
