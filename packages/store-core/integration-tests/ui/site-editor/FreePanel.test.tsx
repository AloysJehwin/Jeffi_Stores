import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FreePanel from '@/components/site-editor/FreePanel'

const layer = (over: Record<string, any> = {}): any => ({ from: 'lg', z: 2, rect: { left: 10, top: 20, width: 30, height: 40 }, ...over })
const handlers = () => ({ onRect: vi.fn(), onRestack: vi.fn(), onFlow: vi.fn() })

describe('FreePanel', () => {
  it('shows the layer rect in percent and where it is placed', () => {
    render(<FreePanel layer={layer()} bp="lg" canWrite {...handlers()} />)
    expect(screen.getByText(/Placed on Desktop\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Left (%)')).toHaveValue('10')
    expect(screen.getByLabelText('Top (%)')).toHaveValue('20')
    expect(screen.getByLabelText('Width (%)')).toHaveValue('30')
    expect(screen.getByLabelText('Height (%)')).toHaveValue('40')
  })

  it('explains that a value inherited from a narrower breakpoint will also place it here', () => {
    render(<FreePanel layer={layer({ from: 'md' })} bp="xl" canWrite {...handlers()} />)
    expect(screen.getByText(/Placed on Tablet; changing it here places it on Wide too/)).toBeInTheDocument()
  })

  it('commits a typed value on blur and on Enter, clamped to the allowed range', () => {
    const h = handlers()
    render(<FreePanel layer={layer()} bp="lg" canWrite {...h} />)
    const left = screen.getByLabelText('Left (%)')
    fireEvent.change(left, { target: { value: '55' } })
    fireEvent.blur(left)
    expect(h.onRect).toHaveBeenLastCalledWith({ left: 55, top: 20, width: 30, height: 40 })
    const top = screen.getByLabelText('Top (%)')
    fireEvent.change(top, { target: { value: '500' } })
    fireEvent.keyDown(top, { key: 'Enter' })
    expect(h.onRect).toHaveBeenLastCalledWith({ left: 10, top: 200, width: 30, height: 40 })
  })

  it('ignores unchanged and non-numeric input, and clears Height to auto', () => {
    const h = handlers()
    render(<FreePanel layer={layer()} bp="lg" canWrite {...h} />)
    const left = screen.getByLabelText('Left (%)')
    fireEvent.blur(left)
    fireEvent.change(left, { target: { value: 'abc' } })
    fireEvent.blur(left)
    expect(h.onRect).not.toHaveBeenCalled()
    const height = screen.getByLabelText('Height (%)')
    fireEvent.change(height, { target: { value: '' } })
    fireEvent.blur(height)
    expect(h.onRect).toHaveBeenLastCalledWith({ left: 10, top: 20, width: 30, height: undefined })
  })

  it('has an auto Height placeholder when the layer is as tall as its content', () => {
    render(<FreePanel layer={layer({ rect: { left: 0, top: 0, width: 50 } })} bp="lg" canWrite {...handlers()} />)
    expect(screen.getByLabelText('Height (%)')).toHaveAttribute('placeholder', 'auto')
    expect(screen.getByLabelText('Height (%)')).toHaveValue('')
  })

  it('restacks and puts the layer back in the flow', () => {
    const h = handlers()
    render(<FreePanel layer={layer()} bp="lg" canWrite {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(h.onRestack).toHaveBeenLastCalledWith('front')
    fireEvent.click(screen.getByRole('button', { name: 'Bring forward' }))
    expect(h.onRestack).toHaveBeenLastCalledWith('forward')
    fireEvent.click(screen.getByRole('button', { name: 'Send backward' }))
    expect(h.onRestack).toHaveBeenLastCalledWith('backward')
    fireEvent.click(screen.getByRole('button', { name: 'Send to back' }))
    expect(h.onRestack).toHaveBeenLastCalledWith('back')
    fireEvent.click(screen.getByRole('button', { name: /Back in the flow/ }))
    expect(h.onFlow).toHaveBeenCalled()
  })

  it('is read-only without write access', () => {
    render(<FreePanel layer={layer()} bp="lg" canWrite={false} {...handlers()} />)
    expect(screen.getByLabelText('Left (%)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Bring to front' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Back in the flow/ })).toBeNull()
  })
})
