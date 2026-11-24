import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// next/dynamic loads the bridge in its own chunk; here it resolves to a stand-in so we can see what Lazy mounts.
vi.mock('next/dynamic', () => ({
  default: () => function Bridge() {
    return <div data-testid="bridge" />
  },
}))

import SiteEditorLazy from '@/components/visitor/site/editor/SiteEditorLazy'

describe('SiteEditorLazy', () => {
  it('mounts the editor bridge', () => {
    render(<SiteEditorLazy />)
    expect(screen.getByTestId('bridge')).toBeInTheDocument()
  })
})
