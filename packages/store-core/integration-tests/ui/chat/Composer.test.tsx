import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Composer from '@/components/chat/Composer'

describe('Composer', () => {
  it('renders the placeholder and a disabled Send until there is text', () => {
    render(<Composer text="" setText={vi.fn()} onSend={vi.fn()} placeholder="Say something" />)
    expect(screen.getByPlaceholderText('Say something')).toBeInTheDocument()
    expect(screen.getByLabelText('Send')).toBeDisabled()
  })

  it('enables Send once there is non-empty text', () => {
    render(<Composer text="hi" setText={vi.fn()} onSend={vi.fn()} />)
    expect(screen.getByLabelText('Send')).toBeEnabled()
  })

  it('typing calls setText and onTyping', () => {
    const setText = vi.fn()
    const onTyping = vi.fn()
    render(<Composer text="" setText={setText} onSend={vi.fn()} onTyping={onTyping} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    expect(setText).toHaveBeenCalledWith('hello')
    expect(onTyping).toHaveBeenCalled()
  })

  it('clicking Send fires onSend with the trimmed text and clears via setText', () => {
    const onSend = vi.fn()
    const setText = vi.fn()
    render(<Composer text="  hey  " setText={setText} onSend={onSend} />)
    fireEvent.click(screen.getByLabelText('Send'))
    expect(onSend).toHaveBeenCalledWith('hey', [])
    expect(setText).toHaveBeenCalledWith('')
  })

  it('Enter (no shift) sends; Shift+Enter does not', () => {
    const onSend = vi.fn()
    render(<Composer text="line" setText={vi.fn()} onSend={onSend} />)
    const box = screen.getByRole('textbox')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('line', [])
  })

  it('renders a notice in place of the input when supplied', () => {
    render(<Composer text="" setText={vi.fn()} onSend={vi.fn()} notice={<span>Chat is closed</span>} />)
    expect(screen.getByText('Chat is closed')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the attach button only when an upload handler is given', () => {
    const { rerender } = render(<Composer text="" setText={vi.fn()} onSend={vi.fn()} />)
    expect(screen.queryByLabelText('Attach files')).toBeNull()
    rerender(<Composer text="" setText={vi.fn()} onSend={vi.fn()} upload={vi.fn()} />)
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument()
  })

  it('renders accessory and inField slots', () => {
    render(
      <Composer
        text=""
        setText={vi.fn()}
        onSend={vi.fn()}
        accessory={<span>acc-slot</span>}
        inField={<span>field-slot</span>}
      />
    )
    expect(screen.getByText('acc-slot')).toBeInTheDocument()
    expect(screen.getByText('field-slot')).toBeInTheDocument()
  })
})
