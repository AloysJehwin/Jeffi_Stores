import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CodeLiteral } from '@/lib/site/code/literals'
import CodeContentFields from '@/components/admin/site-builder/CodeContentFields'

// CodeContentFields: a code section's words/links/pictures as a form. Each field commits on blur or Enter; text may
// not be blanked, links must be internal (/… or #…). Pure props — no server deps to mock.

const lit = (over: Partial<CodeLiteral>): CodeLiteral => ({ id: 'a', kind: 'text', value: 'Hello', label: 'Heading', line: 1, ...over })
const INPUT = 'input-class'

describe('CodeContentFields (render + commit)', () => {
  it('shows the reading placeholder while literals are null', () => {
    render(<CodeContentFields literals={null} onCommit={() => {}} inputClass={INPUT} />)
    expect(screen.getByText('Reading the section…')).toBeInTheDocument()
  })

  it('shows the empty-state copy when there are no literals', () => {
    render(<CodeContentFields literals={[]} onCommit={() => {}} inputClass={INPUT} />)
    expect(screen.getByText(/no words, links or pictures of its own/)).toBeInTheDocument()
  })

  it('renders one field per literal with its label and value', () => {
    render(
      <CodeContentFields
        literals={[lit({ id: 'h', label: 'Heading', value: 'Welcome' }), lit({ id: 'b', kind: 'link', label: 'Button link', value: '/shop' })]}
        onCommit={() => {}}
        inputClass={INPUT}
      />
    )
    expect(screen.getByText('Heading')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Welcome')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/shop')).toBeInTheDocument()
  })

  it('commits a changed text value on blur', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'h', value: 'Old' })]} onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('Old') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New heading' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ id: 'h', from: 'Old', to: 'New heading' })
  })

  it('commits on Enter and does not commit when unchanged', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'h', value: 'Keep' })]} onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('Keep') as HTMLInputElement
    // Blur with no change -> no commit.
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Changed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith({ id: 'h', from: 'Keep', to: 'Changed' })
  })

  it('refuses to commit an emptied text field (reverts the draft)', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'h', value: 'Title' })]} onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('Title') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(input.value).toBe('Title')
  })

  it('rejects an external link: shows the hint and does not commit', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'l', kind: 'link', value: '/ok', label: 'Link' })]} onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('/ok') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://evil.test' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByText(/start with \/ \(like \/products\) or #/)).toBeInTheDocument()
  })

  it('commits a valid internal link', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'l', kind: 'link', value: '/old', label: 'Link' })]} onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('/old') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/products' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith({ id: 'l', from: '/old', to: '/products' })
  })

  it('disables fields and blocks commits when disabled', () => {
    const onCommit = vi.fn<(...a: any[]) => any>()
    render(<CodeContentFields literals={[lit({ id: 'h', value: 'X' })]} disabled onCommit={onCommit} inputClass={INPUT} />)
    const input = screen.getByDisplayValue('X') as HTMLInputElement
    expect(input).toBeDisabled()
  })

  it('renders as a textarea for long text', () => {
    const long = 'x'.repeat(80)
    render(<CodeContentFields literals={[lit({ id: 'h', value: long })]} onCommit={() => {}} inputClass={INPUT} />)
    const el = screen.getByDisplayValue(long)
    expect(el.tagName).toBe('TEXTAREA')
  })

  it('uses renderImage for image literals when provided', () => {
    render(
      <CodeContentFields
        literals={[lit({ id: 'img', kind: 'image', value: 'https://cdn.test/a.jpg', label: 'Picture' })]}
        onCommit={() => {}}
        inputClass={INPUT}
        renderImage={({ literal }) => <div data-testid="picker">{literal.label}</div>}
      />
    )
    expect(screen.getByTestId('picker')).toHaveTextContent('Picture')
  })
})
