import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuantityInput from '@/components/shared/QuantityInput'

// QuantityInput dispatches on `dimension`: count -> stepper, weight/volume -> slider stepper,
// area -> W×H, length -> tape ruler. These cover the stepper/slider/area paths and their
// clamp + emit behaviour. The length ruler relies on scroll/ResizeObserver DOM APIs not modelled
// here, so it is covered only for crash-free render.

const base = {
  quantity: 2,
  quantityRaw: '2',
  unitLabel: 'kg',
  unitKey: 'kg',
  effectiveStock: 100,
  qtyStep: 1,
  qtyMin: 1,
  qtyMax: undefined as number | undefined,
}

describe('QuantityInput — count stepper', () => {
  it('renders the raw value and unit', () => {
    render(<QuantityInput {...base} dimension="count" onChange={() => {}} />)
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByText('kg')).toBeInTheDocument()
  })

  it('increments by one on the increase button', () => {
    const onChange = vi.fn()
    render(<QuantityInput {...base} dimension="count" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    expect(onChange).toHaveBeenCalledWith(3, '3')
  })

  it('decrements but never below qtyMin', () => {
    const onChange = vi.fn()
    render(<QuantityInput {...base} dimension="count" quantity={1} quantityRaw="1" onChange={onChange} />)
    // already at min -> decrease button disabled
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled()
  })

  it('disables increase when at the effective ceiling', () => {
    render(<QuantityInput {...base} dimension="count" quantity={5} quantityRaw="5" effectiveStock={5} onChange={() => {}} />)
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled()
  })

  it('clamps a typed value to the ceiling (stock)', () => {
    const onChange = vi.fn()
    render(<QuantityInput {...base} dimension="count" effectiveStock={10} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '999' } })
    // clamped to 10, raw preserved as typed
    expect(onChange).toHaveBeenCalledWith(10, '999')
  })

  it('shows the Min/Max hint when a max is set', () => {
    render(<QuantityInput {...base} dimension="count" qtyMax={8} onChange={() => {}} />)
    expect(screen.getByText(/Max: 8/)).toBeInTheDocument()
  })
})

describe('QuantityInput — weight/volume slider', () => {
  it('renders and increments by the step', () => {
    const onChange = vi.fn()
    render(
      <QuantityInput {...base} dimension="weight" quantity={0.5} quantityRaw="0.5" qtyStep={0.5} qtyMin={0.5} onChange={onChange} />
    )
    fireEvent.click(screen.getByLabelText('Increase quantity'))
    expect(onChange).toHaveBeenCalledWith(1, '1')
  })

  it('accepts a decimal typed value', () => {
    const onChange = vi.fn()
    render(
      <QuantityInput {...base} dimension="volume" quantity={1} quantityRaw="1" qtyStep={0.25} qtyMin={0.25} onChange={onChange} />
    )
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '1.5' } })
    expect(onChange).toHaveBeenCalledWith(1.5, '1.5')
  })
})

describe('QuantityInput — area input', () => {
  it('renders width and height steppers and the area readout', () => {
    render(
      <QuantityInput {...base} dimension="area" quantity={4} quantityRaw="4" unitLabel="m2" qtyStep={1} qtyMin={1} onChange={() => {}} />
    )
    expect(screen.getByText(/Width/)).toBeInTheDocument()
    expect(screen.getByText(/Height/)).toBeInTheDocument()
    expect(screen.getByText(/Area:/)).toBeInTheDocument()
  })
})

describe('QuantityInput — length ruler', () => {
  it('renders without crashing', () => {
    // ResizeObserver/scroll driven; just prove the dispatch path renders in happy-dom.
    const onChange = vi.fn()
    render(
      <QuantityInput
        {...base}
        dimension="length"
        quantity={1}
        quantityRaw="1"
        unitLabel="m"
        qtyStep={0.5}
        qtyMin={0}
        qtyMax={5}
        onChange={onChange}
      />
    )
    expect(screen.getByText('Swipe the tape or hold ‹ › to adjust')).toBeInTheDocument()
  })
})
