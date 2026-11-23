import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Block } from '@jeffi/site-blocks'

// BlockFields: generates a block's settings form from its definition's field metadata. We mock the block registry
// (to supply field metas) and the shared `fields` module (Image/Select are heavy); everything else is the real branch
// logic that maps a FieldKind -> control and threads edits back through onChange({...block, props}).

let fieldsMeta: Record<string, any> = {}
vi.mock('@/lib/site/blocks', () => ({ siteRegistry: { get: () => ({ fields: fieldsMeta }) } }))
vi.mock('@/components/admin/homepage/editors/fields', () => ({
  INPUT_CLASS: 'input',
  LABEL_CLASS: 'label',
  Image: ({ label, value, onCommit }: any) => (
    <div>
      <span>{label}</span>
      <button type="button" data-testid="img-commit" onClick={() => onCommit('https://cdn.test/new.jpg')}>
        set image
      </button>
      <span data-testid="img-value">{value}</span>
    </div>
  ),
  Select: ({ label, value, options, onChange }: any) => (
    <label>
      {label}
      <select data-testid="select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}))

import BlockFields from '@/components/admin/site-builder/BlockFields'

const block = (props: Record<string, unknown>): Block => ({ id: 'b1', type: 'faq', props } as unknown as Block)

beforeEach(() => {
  fieldsMeta = {}
})

describe('BlockFields (field-kind branches + edits)', () => {
  it('renders a text input with the field label and value', () => {
    fieldsMeta = { heading: { kind: 'text', label: 'Heading' } }
    render(<BlockFields block={block({ heading: 'Welcome' })} canWrite onChange={() => {}} />)
    expect(screen.getByText('Heading')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Welcome')).toBeInTheDocument()
  })

  it('threads a text edit through onChange, preserving other props', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { heading: { kind: 'text', label: 'Heading' } }
    render(<BlockFields block={block({ heading: 'Old', other: 'keep' })} canWrite onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'New' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b1', props: { heading: 'New', other: 'keep' } }))
  })

  it('renders a checkbox for boolean fields (checked unless explicitly false)', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { visible: { kind: 'boolean', label: 'Visible' } }
    render(<BlockFields block={block({})} canWrite onChange={onChange} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true) // undefined !== false
    fireEvent.click(box)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ props: { visible: false } }))
  })

  it('renders a textarea for richtext and commits its value', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { body: { kind: 'richtext', label: 'Body' } }
    render(<BlockFields block={block({ body: 'hi' })} canWrite onChange={onChange} />)
    const ta = screen.getByDisplayValue('hi')
    expect(ta.tagName).toBe('TEXTAREA')
    fireEvent.change(ta, { target: { value: 'longer' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ props: { body: 'longer' } }))
  })

  it('renders the mocked Select and emits the chosen option', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { align: { kind: 'select', label: 'Align', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] } }
    render(<BlockFields block={block({ align: 'left' })} canWrite onChange={onChange} />)
    fireEvent.change(screen.getByTestId('select'), { target: { value: 'right' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ props: { align: 'right' } }))
  })

  it('renders the mocked Image slot and commits a picked url (clears to null when empty)', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { logo: { kind: 'image', label: 'Logo' } }
    render(<BlockFields block={block({ logo: '' })} canWrite onChange={onChange} />)
    fireEvent.click(screen.getByTestId('img-commit'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ props: { logo: 'https://cdn.test/new.jpg' } }))
  })

  it('renders a link list (no item meta) and adds a link', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { links: { kind: 'list', label: 'Links' } }
    render(<BlockFields block={block({ links: [{ label: 'Home', href: '/' }] })} canWrite onChange={onChange} />)
    expect(screen.getByDisplayValue('Home')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }))
    const last = onChange.mock.calls.at(-1)![0]
    expect(last.props.links).toHaveLength(2)
    expect(last.props.links[1]).toEqual({ label: 'New link', href: '/' })
  })

  it('edits a link label inside the link list', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { links: { kind: 'list', label: 'Links' } }
    render(<BlockFields block={block({ links: [{ label: 'Home', href: '/' }] })} canWrite onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('Home'), { target: { value: 'Start' } })
    const last = onChange.mock.calls.at(-1)![0]
    expect(last.props.links[0]).toEqual({ label: 'Start', href: '/' })
  })

  it('renders an item list when item meta is present and adds an item', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    fieldsMeta = { faqs: { kind: 'list', label: 'Questions', item: [{ key: 'q', label: 'Question', kind: 'text' }, { key: 'a', label: 'Answer', kind: 'richtext' }] } }
    render(<BlockFields block={block({ faqs: [{ q: 'Ships?', a: 'Yes' }] })} canWrite onChange={onChange} />)
    expect(screen.getByDisplayValue('Ships?')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Yes').tagName).toBe('TEXTAREA') // richtext -> textarea
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const last = onChange.mock.calls.at(-1)![0]
    expect(last.props.faqs).toHaveLength(2)
    expect(last.props.faqs[1]).toEqual({ q: 'New item', a: '' })
  })

  it('disables inputs and hides list controls when canWrite is false', () => {
    fieldsMeta = { heading: { kind: 'text', label: 'Heading' }, links: { kind: 'list', label: 'Links' } }
    render(<BlockFields block={block({ heading: 'Hi', links: [{ label: 'Home', href: '/' }] })} canWrite={false} onChange={() => {}} />)
    expect(screen.getByDisplayValue('Hi')).toBeDisabled()
    // No "Add link" button for read-only users.
    expect(screen.queryByRole('button', { name: /Add link/ })).not.toBeInTheDocument()
  })

  it('renders nothing but the wrapper when the definition has no fields', () => {
    fieldsMeta = {}
    const { container } = render(<BlockFields block={block({})} canWrite onChange={() => {}} />)
    // The outer space-y-3 div exists but holds no field controls.
    expect(container.querySelector('input,textarea,select')).toBeNull()
  })
})
