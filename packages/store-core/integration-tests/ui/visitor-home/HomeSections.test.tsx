import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/visitor/home/SectionRenderer', () => ({
  default: ({ section, rowIndex, preview, portal }: any) => (
    <div data-testid={`section-${section.id}`} data-type={section.type} data-row={rowIndex} data-preview={String(!!preview)} data-portal={portal} />
  ),
}))
vi.mock('@/components/visitor/home/Reveal', () => ({
  default: ({ children, disabled }: any) => <div data-testid="reveal" data-disabled={String(disabled)}>{children}</div>,
}))
vi.mock('@/components/visitor/home/SitePreviewBridge', () => ({ default: () => <div data-testid="bridge" /> }))
vi.mock('@/components/visitor/site/editor/SiteEditorGate', () => ({ default: () => <div data-testid="gate" /> }))

import HomeSections from '@/components/visitor/home/HomeSections'

const sec = (id: string, type: string, side?: string) => ({ id, type, config: side ? { layout: { side } } : {} }) as any
const data = {} as any

describe('HomeSections', () => {
  it('renders sections in order, revealing all but the first two and the hero types', () => {
    const sections = [sec('h', 'hero'), sec('a', 'category_grid'), sec('b', 'about'), sec('c', 'blog_teaser')]
    render(<HomeSections sections={sections} data={data} portal="storefront" />)
    expect(screen.getByTestId('section-h').dataset.portal).toBe('storefront')
    // hero is never wrapped; a (index 1) is disabled; b, c are not disabled.
    const reveals = screen.getAllByTestId('reveal')
    expect(reveals.map(r => r.dataset.disabled)).toEqual(['true', 'false', 'false'])
    expect(screen.queryByTestId('bridge')).toBeNull()
  })

  it('pairs a left and right section into one two-column row', () => {
    const { container } = render(<HomeSections sections={[sec('l', 'about', 'left'), sec('r', 'blog_teaser', 'right')]} data={data} />)
    expect(container.querySelector('.lg\\:grid-cols-2')!.children).toHaveLength(2)
  })

  it('keeps an unpaired half section on its own full row', () => {
    const { container } = render(<HomeSections sections={[sec('l', 'about', 'left'), sec('x', 'blog_teaser')]} data={data} />)
    expect(container.querySelector('.lg\\:grid-cols-2')).toBeNull()
  })

  it('numbers product rows in sequence', () => {
    render(<HomeSections sections={[sec('p1', 'product_row'), sec('p2', 'product_row')]} data={data} />)
    expect(screen.getByTestId('section-p1').dataset.row).toBe('0')
    expect(screen.getByTestId('section-p2').dataset.row).toBe('1')
  })

  it('makes each block selectable on the Site Builder canvas', () => {
    const { container } = render(<HomeSections selectable sections={[sec('a', 'about'), sec('b', 'hero')]} data={data} />)
    expect(screen.getByTestId('bridge')).toBeInTheDocument()
    expect(screen.getByTestId('gate')).toBeInTheDocument()
    expect(container.querySelector('[data-block-id="a"]')).toBeInTheDocument()
    expect(container.querySelector('[data-block-id="b"]')).toBeInTheDocument()
    expect(screen.getByTestId('section-a').dataset.preview).toBe('true')
    expect(screen.getByTestId('reveal').dataset.disabled).toBe('true')
  })

  it('renders nothing for no sections', () => {
    const { container } = render(<HomeSections sections={[]} data={data} />)
    expect(container).toBeEmptyDOMElement()
  })
})
