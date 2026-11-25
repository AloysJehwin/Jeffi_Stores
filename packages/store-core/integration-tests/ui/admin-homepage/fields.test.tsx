import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let canAi = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanUseAi: () => canAi }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, disabled }: any) => (
    <select aria-label="sel" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ fieldLabel, context, children }: any) => <div data-testid="ai" data-label={fieldLabel} data-context={context}>{children}</div> }))
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label, onChange, value }: any) => (
    <div>
      <span>{`media:${label}`}</span>
      <button onClick={() => onChange({ image: 'https://cdn/new.png', video: value.video })}>set-image</button>
    </div>
  ),
}))
vi.mock('@/components/ui/DateTimePicker', () => ({ default: ({ value, onChange }: any) => <input aria-label="when" value={value} onChange={e => onChange(e.target.value)} /> }))
vi.mock('@/components/ui/Toggle', () => ({ default: ({ checked, onChange, disabled }: any) => <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /> }))

import {
  Text, TextArea, NumberField, Select, DateTimeField, ToggleField, Image, Grid, Note, AiCopyScope,
  useSectionBinding, HeadingFields, CtaFields, LayoutField, LimitField, VisitorField, PlacementFields, copyHint, sectionCopy,
} from '@/components/admin/homepage/editors/fields'

const baseSection = { id: 's1', type: 'product_row', title: null, subtitle: null, eyebrow: null, cta_label: null, cta_url: null, config: {}, display_order: 0, is_active: true, starts_at: null, ends_at: null } as never
const props = (over: Record<string, unknown> = {}, section: Record<string, unknown> = {}) => ({
  section: { ...(baseSection as object), ...section }, canWrite: true, onChange: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined), ...over,
}) as any

describe('Text and TextArea', () => {
  it('commits on blur only when changed, with an AI sparkle wrapped around', () => {
    const onCommit = vi.fn()
    render(<AiCopyScope context="Hero banner."><Text label="Heading" value="Old" disabled={false} onCommit={onCommit} hint="Shown big" /></AiCopyScope>)
    expect(screen.getByTestId('ai').dataset.label).toBe('Heading')
    expect(screen.getByTestId('ai').dataset.context).toContain('Hero banner.')
    expect(screen.getByText('Shown big')).toBeInTheDocument()
    const input = screen.getByDisplayValue('Old')
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('New')
  })

  it('skips the sparkle when disabled, ai is off or the plan lacks AI', () => {
    const { rerender } = render(<Text label="Button link" value="/x" disabled={false} ai={false} onCommit={vi.fn()} />)
    expect(screen.queryByTestId('ai')).not.toBeInTheDocument()
    rerender(<Text label="Heading" value="x" disabled onCommit={vi.fn()} />)
    expect(screen.queryByTestId('ai')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('x')).toBeDisabled()
    canAi = false
    rerender(<Text label="Heading" value="x" disabled={false} onCommit={vi.fn()} />)
    expect(screen.queryByTestId('ai')).not.toBeInTheDocument()
    canAi = true
  })

  it('follows an external value change while not focused', () => {
    const { rerender } = render(<Text label="Heading" value="A" disabled={false} onCommit={vi.fn()} />)
    rerender(<Text label="Heading" value="B" disabled={false} onCommit={vi.fn()} />)
    expect(screen.getByDisplayValue('B')).toBeInTheDocument()
  })

  it('TextArea commits on blur', () => {
    const onCommit = vi.fn()
    render(<TextArea label="Subtitle" value="" disabled={false} onCommit={onCommit} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'Hello' } })
    fireEvent.blur(ta)
    expect(onCommit).toHaveBeenCalledWith('Hello')
  })
})

describe('simple fields', () => {
  it('NumberField commits valid numbers and reverts invalid ones', () => {
    const onCommit = vi.fn()
    render(<NumberField label="Limit" value={8} disabled={false} min={1} hint="max 20" onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(12)
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect((input as HTMLInputElement).value).toBe('8')
  })

  it('Select, ToggleField, Note and Grid render and report changes', () => {
    const onChange = vi.fn()
    const onToggle = vi.fn()
    render(
      <Grid>
        <Select label="Layout" value="grid" options={[{ value: 'grid', label: 'Grid' }, { value: 'carousel', label: 'Carousel' }]} disabled={false} onChange={onChange} />
        <ToggleField label="Active" checked={false} disabled={false} hint="hide" onChange={onToggle} />
        <Note>Heads up</Note>
      </Grid>
    )
    fireEvent.change(screen.getByLabelText('sel'), { target: { value: 'carousel' } })
    expect(onChange).toHaveBeenCalledWith('carousel')
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.getByText('Heads up')).toBeInTheDocument()
  })

  it('DateTimeField converts between ISO and local values', () => {
    const onCommit = vi.fn()
    render(<DateTimeField label="Starts" value="2026-03-01T10:30:00Z" disabled={false} onCommit={onCommit} />)
    expect((screen.getByLabelText('when') as HTMLInputElement).value).toMatch(/^2026-03-01T\d\d:\d\d$/)
    fireEvent.change(screen.getByLabelText('when'), { target: { value: '' } })
    expect(onCommit).toHaveBeenCalledWith(null)
    fireEvent.change(screen.getByLabelText('when'), { target: { value: '2026-04-02T09:00' } })
    expect(onCommit).toHaveBeenLastCalledWith(new Date('2026-04-02T09:00').toISOString())
  })

  it('Image commits the picked media, and a pasted link on blur', () => {
    const onCommit = vi.fn()
    render(<Image label="Banner" value="https://cdn/old.png" video="https://cdn/v.mp4" allowVideo disabled={false} onCommit={onCommit} />)
    fireEvent.click(screen.getByText('set-image'))
    expect(onCommit).toHaveBeenCalledWith('https://cdn/new.png', 'https://cdn/v.mp4')
    const link = screen.getByLabelText('Banner link')
    fireEvent.change(link, { target: { value: ' /images/x.png ' } })
    fireEvent.blur(link)
    expect(onCommit).toHaveBeenLastCalledWith('/images/x.png', 'https://cdn/v.mp4')
  })
})

describe('section-bound fields', () => {
  it('copyHint and sectionCopy fall back to the live defaults', () => {
    expect(copyHint(false, 'x')).toBe('x')
    expect(copyHint(true)).toContain('Live default')
    expect(copyHint(true, 'x')).toMatch(/^x Live default/)
    expect(sectionCopy(props({ options: { copyDefaults: { product_row: { title: 'Fresh picks' } } } }))).toMatchObject({ title: 'Fresh picks' })
  })

  it('HeadingFields saves the heading as a column, null when cleared', () => {
    const p = props({}, { title: 'Hot picks' })
    render(<HeadingFields props={p} eyebrowHint="tiny" />)
    const heading = screen.getByDisplayValue('Hot picks')
    fireEvent.change(heading, { target: { value: '' } })
    fireEvent.blur(heading)
    expect(p.onChange).toHaveBeenCalledWith('s1', { title: null })
    expect(p.onSave).toHaveBeenCalledWith('s1', { title: null })
  })

  it('CtaFields saves label and link under the API names', () => {
    const p = props({}, { cta_label: 'Shop', cta_url: '/products' })
    render(<CtaFields props={p} />)
    const label = screen.getByDisplayValue('Shop')
    fireEvent.change(label, { target: { value: 'Buy' } })
    fireEvent.blur(label)
    expect(p.onSave).toHaveBeenCalledWith('s1', { ctaLabel: 'Buy' })
    const url = screen.getByDisplayValue('/products')
    fireEvent.change(url, { target: { value: '/sale' } })
    fireEvent.blur(url)
    expect(p.onSave).toHaveBeenCalledWith('s1', { ctaUrl: '/sale' })
  })

  it('LayoutField, LimitField and VisitorField save into config', () => {
    const p = props({}, { config: { limit: 6 } })
    render(<><LayoutField props={p} /><LimitField props={p} /><VisitorField props={props({}, { type: 'business_products' })} /></>)
    const [layout, visitor] = screen.getAllByLabelText('sel')
    fireEvent.change(layout, { target: { value: 'carousel' } })
    expect(p.onSave).toHaveBeenCalledWith('s1', { config: { limit: 6, layout: 'carousel' } })
    const limit = screen.getByRole('spinbutton')
    fireEvent.change(limit, { target: { value: '9' } })
    fireEvent.blur(limit)
    expect(p.onSave).toHaveBeenLastCalledWith('s1', { config: { limit: 9 } })
    expect(visitor).toBeInTheDocument()
  })

  it('fields are disabled without write access', () => {
    render(<LayoutField props={props({ canWrite: false })} />)
    expect(screen.getByLabelText('sel')).toBeDisabled()
  })

  it('PlacementFields edits position and repeat, and explains the right half of a row', () => {
    const p = props({}, { config: { placement: { after: 4 } } })
    const { rerender } = render(<PlacementFields props={p} />)
    const [after, every] = screen.getAllByRole('spinbutton')
    fireEvent.change(after, { target: { value: '8' } })
    fireEvent.blur(after)
    expect(p.onSave).toHaveBeenCalledWith('s1', { config: { placement: { after: 8 } } })
    fireEvent.change(every, { target: { value: '2' } })
    fireEvent.blur(every)
    expect(p.onSave).toHaveBeenLastCalledWith('s1', { config: { placement: { after: 4, every: 4 } } })
    rerender(<PlacementFields props={{ ...p, half: 'right' }} />)
    expect(screen.getByText(/right half of a two-column row/)).toBeInTheDocument()
  })
})

describe('useSectionBinding', () => {
  it('exposes config reads and column writes', () => {
    const p = props({}, { config: { limit: 3, layout: 'carousel', note: 'hi' } })
    function Probe() {
      const b = useSectionBinding(p)
      return <button onClick={() => b.title('T')}>{`${b.limit}-${b.layout}-${b.str('note')}`}</button>
    }
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: '3-carousel-hi' }))
    expect(p.onChange).toHaveBeenCalledWith('s1', { title: 'T' })
  })
})
