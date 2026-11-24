import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DEFAULT_THEME } from '@jeffi/site-blocks'
import StylePanel, { themeSwatches } from '@/components/site-editor/StylePanel'

// The style panel reads an element's classes at the breakpoint being edited and reports property changes; the shell
// turns those into class operations (lib/site/code/classes.ts).

describe('StylePanel', () => {
  it('shows values inherited from a narrower breakpoint and sets this one', () => {
    const onChange = vi.fn()
    render(<StylePanel className="text-2xl px-4 lg:px-8" bp="lg" theme={DEFAULT_THEME} canWrite onChange={onChange} />)
    expect(screen.getByLabelText('Size')).toHaveValue('2xl')
    expect(screen.getAllByText('from Phone').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Padding, sides')).toHaveValue('8')
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '4xl' } })
    expect(onChange).toHaveBeenLastCalledWith('fontSize', '4xl')
    fireEvent.click(screen.getByLabelText('Clear'))
    expect(onChange).toHaveBeenLastCalledWith('paddingX', null)
  })

  it('picks theme colours, any hex, and the theme’s two fonts', () => {
    const onChange = vi.fn()
    render(<StylePanel className="" bp="base" theme={DEFAULT_THEME} canWrite onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Text colour: primary 500'))
    expect(onChange).toHaveBeenLastCalledWith('textColor', 'primary-500')
    const hex = screen.getByLabelText('Background, hex')
    fireEvent.change(hex, { target: { value: '#12AB3c' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('bgColor', '[#12ab3c]')
    fireEvent.change(hex, { target: { value: 'red' } })
    fireEvent.blur(hex)
    expect(onChange).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'display' } })
    expect(onChange).toHaveBeenLastCalledWith('fontFamily', 'display')
    expect(themeSwatches(DEFAULT_THEME)).toHaveLength(4)
  })

  it('is read-only without write access', () => {
    render(<StylePanel className="text-sm" bp="md" theme={null} canWrite={false} onChange={() => {}} />)
    expect(screen.getByLabelText('Size')).toBeDisabled()
    expect(screen.queryByLabelText('Clear')).toBeNull()
  })
})
