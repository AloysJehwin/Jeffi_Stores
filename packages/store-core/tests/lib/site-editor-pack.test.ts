import { describe, it, expect, vi } from 'vitest'

// The responsive sweep's editor page (tests/responsive/editor-pack.ts) builds and saves as the editor would, so the
// advisory CI sweep fails on a layout, never on its own fixture.

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }))

import type { CodeNode } from '@jeffi/site-blocks'
import { layersAt } from '@/components/site-editor/free-ops'
import type { CompiledSection } from '@/lib/site/code/compile'
import { CONVERTED, editorHomeDoc, heroTree } from '../../../../tests/responsive/editor-pack'

describe('the responsive sweep’s editor page', () => {
  it('places the hero’s layers on Desktop and Tablet, and the badge on Phone too', () => {
    const tree = heroTree()
    expect(layersAt(tree, 'lg')).toHaveLength(2)
    expect(layersAt(tree, 'md')).toHaveLength(1)
    expect(layersAt(tree, 'base')).toHaveLength(1)
  })

  it('saves every section as a compiled v2 code section, one per convertible kind after the hero', async () => {
    const doc = await editorHomeDoc()
    expect(doc.order).toEqual(['ed-hero', ...CONVERTED.map(b => b.id)])
    for (const id of doc.order) {
      const b = doc.blocks[id]
      expect(b.type).toBe('code_section')
      expect((b.props.tree as CodeNode)?.id).toBeTruthy()
      expect((b.props.compiled as CompiledSection | null)?.css).toBeTruthy()
    }
    const css = (doc.blocks['ed-hero'].props.compiled as CompiledSection).css
    expect(css).toMatch(/position:\s*absolute/)
    expect(css).toMatch(/@media \(min-width:\s*1024px\)/)
  })
})
