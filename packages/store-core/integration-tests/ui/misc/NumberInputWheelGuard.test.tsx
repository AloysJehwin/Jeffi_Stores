import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import NumberInputWheelGuard from '@/components/NumberInputWheelGuard'

describe('NumberInputWheelGuard', () => {
  it('blurs a focused number input on wheel so the scroll cannot edit it', () => {
    render(
      <>
        <NumberInputWheelGuard />
        <input data-testid="n" type="number" defaultValue={5} />
      </>
    )
    const input = document.querySelector('[data-testid="n"]') as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)
    fireEvent.wheel(input)
    expect(document.activeElement).not.toBe(input)
    expect(input.value).toBe('5')
  })

  it('leaves text inputs and unfocused number inputs alone', () => {
    render(
      <>
        <NumberInputWheelGuard />
        <input data-testid="t" type="text" />
        <input data-testid="n" type="number" />
      </>
    )
    const text = document.querySelector('[data-testid="t"]') as HTMLInputElement
    const num = document.querySelector('[data-testid="n"]') as HTMLInputElement
    text.focus()
    fireEvent.wheel(text)
    expect(document.activeElement).toBe(text)
    fireEvent.wheel(num)
    expect(document.activeElement).toBe(text)
  })

  it('removes its listener on unmount', () => {
    const { unmount } = render(
      <>
        <NumberInputWheelGuard />
        <input data-testid="n" type="number" />
      </>
    )
    const input = document.querySelector('[data-testid="n"]') as HTMLInputElement
    unmount()
    document.body.appendChild(input)
    input.focus()
    fireEvent.wheel(input)
    expect(document.activeElement).toBe(input)
    input.remove()
  })
})
