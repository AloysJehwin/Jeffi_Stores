import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiBox from '@/components/site-editor/AiBox'

describe('AiBox', () => {
  it('asks with the trimmed instruction on click and on Ctrl+Enter', () => {
    const onAsk = vi.fn()
    render(<AiBox target="Heading" busy={false} onAsk={onAsk} />)
    const box = screen.getByLabelText('What to change in Heading')
    expect(box).toHaveAttribute('placeholder', 'e.g. Make heading shorter and bolder')
    fireEvent.change(box, { target: { value: '  make it punchier ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(onAsk).toHaveBeenLastCalledWith('make it punchier')
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(onAsk).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onAsk).toHaveBeenCalledTimes(2)
  })

  it('keeps Change disabled until at least three characters are typed', () => {
    const onAsk = vi.fn()
    render(<AiBox target="Hero" busy={false} onAsk={onAsk} />)
    const btn = screen.getByRole('button', { name: 'Change' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What to change in Hero'), { target: { value: 'ab' } })
    expect(btn).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('What to change in Hero'), { key: 'Enter', metaKey: true })
    expect(onAsk).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('What to change in Hero'), { target: { value: 'abc' } })
    expect(btn).toBeEnabled()
  })

  it('locks the box and shows progress while a change is running, with an optional note', () => {
    const onAsk = vi.fn()
    render(<AiBox target="Hero" note="Applies to the whole section" busy onAsk={onAsk} />)
    expect(screen.getByLabelText('What to change in Hero')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Changing…' })).toBeDisabled()
    expect(screen.getByText('Applies to the whole section')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByLabelText('What to change in Hero'), { key: 'Enter', ctrlKey: true })
    expect(onAsk).not.toHaveBeenCalled()
  })
})
