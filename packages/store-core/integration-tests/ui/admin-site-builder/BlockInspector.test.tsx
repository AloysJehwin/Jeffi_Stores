import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Block } from '@jeffi/site-blocks'
import BlockInspector, { applySectionPatch, blockAsSection } from '@/components/admin/site-builder/BlockInspector'
import { siteRegistry } from '@/lib/site/blocks'

// BlockInspector: the selected block's settings. A section block reads as a homepage section row (blockAsSection)
// and an edit to the row writes back to the block (applySectionPatch); the hero has its own slide list; code and
// composed blocks add their own panels. Those panels and the section form are stubbed.
vi.mock('@/components/admin/homepage/SectionConfigFields', () => ({
  default: ({ section, canWrite, onChange }: any) => (
    <div data-testid="section-fields" data-type={section.type}>
      <button type="button" disabled={!canWrite} onClick={() => onChange(section.id, { title: 'From form', cta_label: 'Go' })}>
        edit via form
      </button>
    </div>
  ),
}))
vi.mock('@/components/admin/site-builder/BlockFields', () => ({ default: () => <div data-testid="block-fields" /> }))
vi.mock('@/components/admin/site-builder/ComposedEditor', () => ({ default: () => <div data-testid="composed-editor" /> }))
vi.mock('@/components/admin/site-builder/CodeSectionPanel', () => ({ default: ({ pointed }: any) => <div data-testid="code-panel">{pointed}</div> }))

const ref = { audience: 'store', surface: 'web', page: 'home' } as const
const block = (type: string, props: Record<string, unknown> = {}, extra: Partial<Block> = {}): Block => ({ id: 'b1', type, v: 1, props, ...extra })
const options = { counts: {} } as any

function setup(b: Block, canWrite = true, extra: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  render(<BlockInspector block={b} pageRef={ref} options={options} canWrite={canWrite} onChange={onChange} {...extra} />)
  return { onChange }
}

describe('blockAsSection', () => {
  it('reads a block as a section row, with layout identifiers from the page ref', () => {
    const s = blockAsSection(block('product_row', { title: 'Fresh', subtitle: 's', eyebrow: 'e', ctaLabel: 'Go', ctaUrl: '/x', config: { limit: 4 } }, { visibility: { hidden: true, from: 'F', to: 'T' } }), ref)
    expect(s).toMatchObject({ id: 'b1', type: 'product_row', title: 'Fresh', subtitle: 's', eyebrow: 'e', cta_label: 'Go', cta_url: '/x', config: { limit: 4 }, is_active: false, starts_at: 'F', ends_at: 'T', surface: 'web', page: 'home', audience: 'store' })
  })

  it('defaults missing props to null / empty and shows a block with no visibility as active', () => {
    const s = blockAsSection(block('product_row'), ref)
    expect(s).toMatchObject({ title: null, cta_label: null, config: {}, is_active: true, starts_at: null, ends_at: null })
  })
})

describe('applySectionPatch', () => {
  it('writes copy and CTA fields back to the block props', () => {
    const next = applySectionPatch(block('product_row', { keep: 1 }), { title: 'T', subtitle: null, eyebrow: 'E', cta_label: 'Go', cta_url: '/x', config: { limit: 2 } })
    expect(next.props).toEqual({ keep: 1, title: 'T', subtitle: null, eyebrow: 'E', ctaLabel: 'Go', ctaUrl: '/x', config: { limit: 2 } })
  })

  it('maps visibility: hidden and the show window', () => {
    const next = applySectionPatch(block('product_row'), { is_active: false, starts_at: 'F', ends_at: 'T' })
    expect(next.visibility).toEqual({ hidden: true, from: 'F', to: 'T' })
  })

  it('drops the visibility object once nothing restricts the block', () => {
    const hidden = block('product_row', {}, { visibility: { hidden: true } })
    expect(applySectionPatch(hidden, { is_active: true }).visibility).toBeUndefined()
  })

  it('leaves untouched fields alone', () => {
    const b = block('product_row', { title: 'Keep' })
    expect(applySectionPatch(b, { cta_label: 'X' }).props.title).toBe('Keep')
  })
})

describe('BlockInspector', () => {
  it('names the block from its definition and shows its description', () => {
    const def = siteRegistry.get('product_row')!
    setup(block('product_row'))
    expect(screen.getByText(def.label)).toBeInTheDocument()
    if (def.description) expect(screen.getByText(def.description)).toBeInTheDocument()
  })

  it('toggles whether the block is shown on this layout', () => {
    const { onChange } = setup(block('product_row'))
    const box = screen.getByRole('checkbox', { name: 'Shown on this layout' })
    expect(box).toBeChecked()
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ visibility: { hidden: true } }))
  })

  it('shows the schedule pickers with their placeholders', () => {
    setup(block('product_row'))
    expect(screen.getByText('Right away')).toBeInTheDocument()
    expect(screen.getByText('No end')).toBeInTheDocument()
  })

  it('clears a saved end time through the picker', () => {
    const { onChange } = setup(block('product_row', {}, { visibility: { to: '2099-03-15T10:00:00.000Z' } }))
    fireEvent.click(screen.getByText(/Mar 2099/))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange.mock.calls.at(-1)![0].visibility).toBeUndefined()
  })

  it('uses the section form for a section block and writes its edits back', () => {
    const { onChange } = setup(block('product_row', { title: 'Old' }))
    expect(screen.getByTestId('section-fields')).toHaveAttribute('data-type', 'product_row')
    expect(screen.queryByTestId('block-fields')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'edit via form' }))
    expect(onChange.mock.calls[0][0].props).toMatchObject({ title: 'From form', ctaLabel: 'Go' })
  })

  it('locks the section form and the visibility box without write access', () => {
    setup(block('product_row'), false)
    expect(screen.getByRole('checkbox', { name: 'Shown on this layout' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'edit via form' })).toBeDisabled()
  })

  it('shows the generated field form instead for a non-section block', () => {
    setup(block('faq'))
    expect(screen.getByTestId('block-fields')).toBeInTheDocument()
    expect(screen.queryByTestId('section-fields')).toBeNull()
  })

  it('adds the composed editor for composed blocks and the code panel (with what was pointed at) for code sections', () => {
    const a = render(<BlockInspector block={block('composed')} pageRef={ref} options={options} canWrite onChange={() => {}} />)
    expect(screen.getByTestId('composed-editor')).toBeInTheDocument()
    a.unmount()
    render(<BlockInspector block={block('code_section')} pageRef={ref} options={options} canWrite onChange={() => {}} pointed="the title" />)
    expect(screen.getByTestId('code-panel')).toHaveTextContent('the title')
  })

  describe('hero slides', () => {
    const slides = [
      { id: 's1', title: 'First', is_active: true },
      { id: 's2', title: '', is_active: false },
    ]
    const hero = () => block('hero', { slides })

    it('lists the slides, falling back to a numbered name, and flags hidden ones', () => {
      setup(hero())
      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Slide 2')).toBeInTheDocument()
      expect(screen.getByText('Hidden')).toBeInTheDocument()
    })

    it('edits a slide field, storing a cleared field as null', () => {
      const { onChange } = setup(hero())
      const title = screen.getAllByLabelText('Title')[0]
      fireEvent.change(title, { target: { value: 'Renamed' } })
      expect(onChange.mock.calls.at(-1)![0].props.slides[0]).toMatchObject({ id: 's1', title: 'Renamed' })
      fireEvent.change(title, { target: { value: '' } })
      expect(onChange.mock.calls.at(-1)![0].props.slides[0].title).toBeNull()
    })

    it('toggles a slide’s Shown state', () => {
      const { onChange } = setup(hero())
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'Shown' })[1])
      expect(onChange.mock.calls[0][0].props.slides[1].is_active).toBe(true)
    })

    it('reorders and removes slides', () => {
      const { onChange } = setup(hero())
      expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled()
      fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
      expect(onChange.mock.calls[0][0].props.slides.map((s: any) => s.id)).toEqual(['s2', 's1'])
      fireEvent.click(screen.getAllByRole('button', { name: /Remove/ })[0])
      expect(onChange.mock.calls[1][0].props.slides.map((s: any) => s.id)).toEqual(['s2'])
    })

    it('adds a new slide with a minted id', () => {
      const { onChange } = setup(hero())
      fireEvent.click(screen.getByRole('button', { name: /Add slide/ }))
      const next = onChange.mock.calls[0][0].props.slides
      expect(next).toHaveLength(3)
      expect(next[2]).toMatchObject({ title: 'New slide', is_active: true, filter_in_stock: false, filter_on_sale: false })
      expect(next[2].id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('hides add / remove / reorder and locks fields without write access', () => {
      setup(hero(), false)
      expect(screen.queryByRole('button', { name: /Add slide/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Move down' })).toBeNull()
      expect(screen.getAllByLabelText('Title')[0]).toBeDisabled()
    })
  })
})
