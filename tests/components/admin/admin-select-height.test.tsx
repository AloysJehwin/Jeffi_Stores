import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AdminSelect from '@/components/admin/AdminSelect'

describe('AdminSelect', () => {
  it('does not clamp a list of two-line options below its content', () => {
    const options = [
      { value: 'k1', label: 'Key one', hint: 'messages:send · active' },
      { value: 'k2', label: 'Key two', hint: 'documents:render · active' },
    ]
    render(<AdminSelect value="k1" options={options} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('combobox'))
    const list = screen.getByRole('listbox')
    const dropdown = list.closest('[data-adminselect-dropdown]') as HTMLElement
    expect(dropdown.style.maxHeight).toBe('')
    expect(list.style.maxHeight).toBe('')
    expect(list.className).toContain('max-h-[280px]')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('documents:render · active')).toBeTruthy()
  })

  it('keeps the selected option apart from the highlight', () => {
    render(<AdminSelect value="b" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('combobox'))
    const b = screen.getByRole('option', { name: 'B' })
    expect(b.getAttribute('aria-selected')).toBe('true')
    expect(b.hasAttribute('data-highlighted')).toBe(false)
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'A' }))
    expect(screen.getByRole('option', { name: 'A' }).hasAttribute('data-highlighted')).toBe(true)
  })
})
