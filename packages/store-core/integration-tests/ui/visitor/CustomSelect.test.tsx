import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import CustomSelect from '@/components/visitor/CustomSelect'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]
const setup = (over: Record<string, any> = {}) => {
  const onChange = vi.fn()
  render(<CustomSelect id="s" label="Reason" value="" options={options} onChange={onChange} {...over} />)
  return { onChange, box: screen.getByRole('combobox') }
}

describe('CustomSelect', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('shows the label, the placeholder and a collapsed combobox', () => {
    const { box } = setup()
    expect(screen.getByLabelText('Reason')).toBe(box)
    expect(box).toHaveTextContent('Select...')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows the selected label, a custom placeholder, and required state', () => {
    const a = setup({ value: 'b' })
    expect(a.box).toHaveTextContent('Beta')
  })

  it('custom placeholder and aria-required', () => {
    const { box } = setup({ placeholder: 'Pick one…', required: true })
    expect(box).toHaveTextContent('Pick one…')
    expect(box).toHaveAttribute('aria-required', 'true')
  })

  it('opens on click, lists options with the current one selected, and picks one', () => {
    const { onChange, box } = setup({ value: 'b' })
    fireEvent.click(box)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('click again closes it', () => {
    const { box } = setup()
    fireEvent.click(box)
    fireEvent.click(box)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keyboard: Enter opens, arrows move, Enter picks', () => {
    const { onChange, box } = setup()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('ArrowDown on a closed select opens it at the current value; Space opens too', () => {
    const { box } = setup({ value: 'c' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.keyDown(box, { key: ' ' })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('hovering an option highlights it, and an outside mousedown closes the list', () => {
    const { box } = setup()
    fireEvent.click(box)
    const beta = screen.getByRole('option', { name: 'Beta' })
    fireEvent.mouseEnter(beta)
    expect(beta.className).toContain('bg-accent-50')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a disabled select ignores clicks and keys', () => {
    const { onChange, box } = setup({ disabled: true })
    expect(box).toBeDisabled()
    fireEvent.click(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens upward when there is no room below', () => {
    const { box } = setup()
    const wrap = box.parentElement!
    wrap.getBoundingClientRect = () => ({ top: 700, bottom: 740, left: 0, right: 100, width: 100, height: 40 }) as DOMRect
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    fireEvent.click(box)
    expect(screen.getByRole('listbox').parentElement!.className).toContain('bottom-full')
  })
})
