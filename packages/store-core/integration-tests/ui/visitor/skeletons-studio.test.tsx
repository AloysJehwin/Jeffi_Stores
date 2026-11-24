import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@jeffi/site-blocks', () => ({
  topBlocks: (doc: any) => doc.blocks,
  blockVisible: (b: any) => b.visible !== false,
}))
vi.mock('@/components/visitor/site/code/CodeSectionSkeleton', () => ({
  default: ({ section, page }: any) => <div data-testid="code-skel">{`code:${page}:${section ? 'compiled' : 'none'}`}</div>,
}))
vi.mock('@/components/visitor/skeletons/sections', () => ({
  SectionSkeleton: ({ type }: any) => <div data-testid="section-skel">{`section:${type}`}</div>,
}))
vi.mock('@/lib/site/blocks', () => ({
  CORE_BLOCKS: [{ type: 'product_grid' }],
  isSectionBlock: (t: string) => t === 'hero' || t === 'features',
}))
const loadSitePage = vi.fn()
vi.mock('@/lib/site/page', () => ({ loadSitePage: (...a: any[]) => loadSitePage(...a) }))

import { StudioPageSkeleton, studioSkeleton } from '@/components/visitor/skeletons/studio'

const doc = (blocks: any[]) => ({ blocks }) as any

describe('StudioPageSkeleton', () => {
  it('draws each visible block in order: code, section, and the page core; skips unknown or hidden ones', () => {
    render(
      <StudioPageSkeleton
        page={'home' as any}
        core={<div data-testid="core">core</div>}
        doc={doc([
          { id: '1', type: 'code_section', props: { compiled: { x: 1 } } },
          { id: '2', type: 'hero', props: {} },
          { id: '3', type: 'product_grid', props: {} },
          { id: '4', type: 'mystery', props: {} },
          { id: '5', type: 'features', props: {}, visible: false },
        ])}
      />
    )
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('code-skel')).toHaveTextContent('code:home:compiled')
    expect(screen.getByTestId('section-skel')).toHaveTextContent('section:hero')
    expect(screen.getByTestId('core')).toBeInTheDocument()
    expect(screen.queryByText('section:features')).not.toBeInTheDocument()
  })

  it('passes a missing compiled section as null', () => {
    render(<StudioPageSkeleton page={'home' as any} doc={doc([{ id: '1', type: 'code_section', props: {} }])} />)
    expect(screen.getByTestId('code-skel')).toHaveTextContent('code:home:none')
  })
})

describe('studioSkeleton', () => {
  beforeEach(() => loadSitePage.mockReset())

  it('returns null when the page failed to load', async () => {
    loadSitePage.mockRejectedValue(new Error('db down'))
    await expect(studioSkeleton('home' as any)).resolves.toBeNull()
    loadSitePage.mockResolvedValue(null)
    await expect(studioSkeleton('home' as any)).resolves.toBeNull()
  })

  it('returns null when the page has no visible code section', async () => {
    loadSitePage.mockResolvedValue({ doc: doc([{ id: '1', type: 'hero', props: {} }, { id: '2', type: 'code_section', props: {}, visible: false }]) })
    await expect(studioSkeleton('home' as any)).resolves.toBeNull()
    expect(loadSitePage).toHaveBeenCalledWith({ audience: 'store', page: 'home' })
  })

  it('returns the studio skeleton for an AI-designed page', async () => {
    loadSitePage.mockResolvedValue({ doc: doc([{ id: '1', type: 'code_section', props: {} }, { id: '2', type: 'product_grid', props: {} }]) })
    const node = await studioSkeleton('home' as any, <span data-testid="core" />)
    expect(node).not.toBeNull()
    render(<>{node}</>)
    expect(screen.getByTestId('code-skel')).toBeInTheDocument()
    expect(screen.getByTestId('core')).toBeInTheDocument()
  })
})
