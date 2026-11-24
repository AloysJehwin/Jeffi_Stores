import { describe, it, expect, vi, beforeEach } from 'vitest'

const enabled = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/site/store', () => ({ siteEditorEnabled: enabled.fn }))
vi.mock('@/components/visitor/site/editor/SiteEditorLazy', () => ({ default: function SiteEditorLazy() { return null } }))

import SiteEditorGate from '@/components/visitor/site/editor/SiteEditorGate'
import SiteEditorLazy from '@/components/visitor/site/editor/SiteEditorLazy'

beforeEach(() => enabled.fn.mockReset())

describe('SiteEditorGate', () => {
  it('renders the lazy editor bridge when the store has the editor switched on', async () => {
    enabled.fn.mockResolvedValue(true)
    const node: any = await SiteEditorGate()
    expect(node.type).toBe(SiteEditorLazy)
  })

  it('renders nothing when the editor is off', async () => {
    enabled.fn.mockResolvedValue(false)
    expect(await SiteEditorGate()).toBeNull()
  })

  it('renders nothing when the setting cannot be read', async () => {
    // A rejecting lookup, as a plain thenable: vitest's mock bookkeeping flags a real rejected promise as unhandled.
    enabled.fn.mockReturnValue({ catch: (onRejected: () => boolean) => Promise.resolve(onRejected()) })
    expect(await SiteEditorGate()).toBeNull()
  })
})
