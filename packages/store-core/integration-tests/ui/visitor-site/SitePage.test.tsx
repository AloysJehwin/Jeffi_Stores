import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const m = vi.hoisted(() => ({
  loadSectionData: vi.fn(),
  loadSitePage: vi.fn(),
  coreBlockFor: vi.fn(),
  docToRows: vi.fn(),
}))

vi.mock('@jeffi/site-blocks', () => ({
  topBlocks: (doc: any) => doc.list,
  blockVisible: (b: any) => !b.hidden,
}))
vi.mock('@/components/visitor/home/SectionRenderer', () => ({
  default: ({ section, rowIndex, preview }: any) => <div data-testid={`section-${section.id}`} data-row={rowIndex} data-preview={String(preview)} />,
}))
vi.mock('@/components/visitor/home/SitePreviewBridge', () => ({ default: () => <div data-testid="bridge" /> }))
vi.mock('@/components/visitor/site/editor/SiteEditorGate', () => ({ default: () => <div data-testid="gate" /> }))
vi.mock('@/components/visitor/site/ContentBlocks', () => ({
  ContentBlock: ({ block, priority, always }: any) => <div data-testid={`content-${block.id}`} data-priority={String(priority)} data-always={String(always)} />,
}))
vi.mock('@/lib/catalog/homepage-model', () => ({ loadSectionData: m.loadSectionData }))
vi.mock('@/lib/site/page', () => ({ loadSitePage: m.loadSitePage }))
vi.mock('@/lib/site/legacy', () => ({ docToRows: m.docToRows }))
vi.mock('@/lib/site/blocks', () => ({
  isSectionBlock: (t: string) => ['about', 'product_row', 'hero'].includes(t),
  coreBlockFor: m.coreBlockFor,
}))
vi.mock('@/lib/site/composed', () => ({ cleanTree: (t: any) => ({ tree: t }) }))

import { SitePage, renderSitePage } from '@/components/visitor/site/SitePage'

const block = (id: string, type: string, props: any = {}, hidden = false) => ({ id, type, props, hidden })

const render$ = async (el: Promise<any> | any) => render(await el)

beforeEach(() => {
  m.loadSectionData.mockReset().mockResolvedValue({ loaded: true })
  m.loadSitePage.mockReset()
  m.coreBlockFor.mockReset().mockReturnValue(null)
  // Section rows mirror the section-type blocks, in order.
  m.docToRows.mockReset().mockImplementation((doc: any) => ({
    sections: doc.order.map((id: string) => ({ id, type: doc.list.find((b: any) => b.id === id).type })),
  }))
})

const ref = (list: any[]) => ({ list }) as any

describe('SitePage', () => {
  it('renders homepage sections through the section renderer and other blocks as content blocks', async () => {
    await render$(SitePage({ doc: ref([block('a', 'about'), block('t', 'text'), block('p1', 'product_row'), block('p2', 'product_row')]), surface: 'web' as any, audience: 'retail' as any, selectable: false }))
    expect(screen.getByTestId('section-a')).toBeInTheDocument()
    expect(screen.getByTestId('content-t')).toBeInTheDocument()
    expect(screen.getByTestId('section-p1').dataset.row).toBe('0')
    expect(screen.getByTestId('section-p2').dataset.row).toBe('1')
    expect(screen.queryByTestId('bridge')).toBeNull()
    expect(m.loadSectionData).toHaveBeenCalledTimes(1)
  })

  it('skips hidden blocks and does not load section data for a page without sections', async () => {
    await render$(SitePage({ doc: ref([block('t', 'text'), block('h', 'text', {}, true)]), surface: 'web' as any, audience: 'retail' as any, selectable: false }))
    expect(screen.getByTestId('content-t')).toBeInTheDocument()
    expect(screen.queryByTestId('content-h')).toBeNull()
    expect(m.loadSectionData).not.toHaveBeenCalled()
  })

  it('gives the first block with a picture the LCP priority, and the first block always renders', async () => {
    await render$(SitePage({ doc: ref([block('t', 'text'), block('img', 'image_banner', { image: '/b.jpg' }), block('img2', 'image_banner', { image: '/c.jpg' })]), surface: 'web' as any, audience: 'retail' as any, selectable: false }))
    expect(screen.getByTestId('content-t').dataset.priority).toBe('false')
    expect(screen.getByTestId('content-t').dataset.always).toBe('true')
    expect(screen.getByTestId('content-img').dataset.priority).toBe('true')
    expect(screen.getByTestId('content-img2').dataset.priority).toBe('false')
    expect(screen.getByTestId('content-img2').dataset.always).toBe('false')
  })

  it('renders the working part where its block sits, flagging lcp, and appends it when the page lost its block', async () => {
    const core = { product_main: (p: any) => <div data-testid="core" data-lcp={String(!!p.lcp)} />, cart_main: <div data-testid="orphan" /> }
    await render$(SitePage({ doc: ref([block('t', 'text'), block('pm', 'product_main')]), surface: 'web' as any, audience: 'retail' as any, selectable: false, core }))
    expect(screen.getByTestId('core').dataset.lcp).toBe('true')
    expect(screen.getByTestId('orphan')).toBeInTheDocument()
  })

  it('shows a core block even when its visibility says hidden', async () => {
    const core = { product_main: <div data-testid="core" /> }
    await render$(SitePage({ doc: ref([block('pm', 'product_main', {}, true)]), surface: 'web' as any, audience: 'retail' as any, selectable: false, core }))
    expect(screen.getByTestId('core')).toBeInTheDocument()
  })

  it('makes blocks selectable in the builder canvas and prompts for the first block on an empty page', async () => {
    const { container, unmount } = await render$(SitePage({ doc: ref([block('t', 'text')]), surface: 'web' as any, audience: 'retail' as any, selectable: true }))
    expect(screen.getByTestId('bridge')).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(container.querySelector('[data-block-id="t"]')).toBeInTheDocument()
    expect(screen.getByTestId('content-t').dataset.always).toBe('true')
    unmount()
    await render$(SitePage({ doc: ref([]), surface: 'web' as any, audience: 'retail' as any, selectable: true }))
    expect(screen.getByText('This page has no blocks yet. Add one in Site Builder.')).toBeInTheDocument()
  })

  it('shows no empty-page prompt to live visitors', async () => {
    const { container } = await render$(SitePage({ doc: ref([]), surface: 'web' as any, audience: 'retail' as any, selectable: false }))
    expect(container).not.toHaveTextContent('no blocks yet')
  })
})

describe('renderSitePage', () => {
  const pageRef = { page: 'product', audience: 'retail' } as any

  it('returns null when the page has no Site Builder version', async () => {
    m.loadSitePage.mockResolvedValue(null)
    expect(await renderSitePage(pageRef)).toBeNull()
  })

  it('returns null when the page needs a working part that was not supplied', async () => {
    m.loadSitePage.mockResolvedValue({ doc: ref([]), surface: 'web', selectable: false })
    m.coreBlockFor.mockReturnValue({ type: 'product_main' })
    expect(await renderSitePage(pageRef, {}, {})).toBeNull()
  })

  it('renders the page once its working part is supplied', async () => {
    m.loadSitePage.mockResolvedValue({ doc: ref([block('t', 'text')]), surface: 'web', selectable: false })
    m.coreBlockFor.mockReturnValue({ type: 'product_main' })
    const node = await renderSitePage(pageRef, { preview: 'tok' }, { product_main: <div data-testid="core" /> })
    expect(node).not.toBeNull()
    expect(m.loadSitePage).toHaveBeenCalledWith(pageRef, { preview: 'tok' })
    render(await (node as any).type(node!.props))
    expect(screen.getByTestId('core')).toBeInTheDocument()
  })
})
