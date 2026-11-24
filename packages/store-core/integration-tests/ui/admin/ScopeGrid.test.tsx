import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ScopeGrid from '@/components/admin/ScopeGrid'

// ScopeGrid: grouped read/write permission toggles with search, per-group All/None and plan filtering.
// Uses the real scope catalogue; allowedKeys narrows it to a small, predictable set.

const allowed = ['products:read', 'products:write', 'orders:read', 'orders:write']

describe('ScopeGrid', () => {
  it('lists groups collapsed with a picked-of-total count', () => {
    render(<ScopeGrid selected={['products:read']} onToggle={() => {}} allowedKeys={allowed} />)
    expect(screen.getByText('Catalogue')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('0 of 2')).toBeInTheDocument()
    expect(screen.queryByText('Products (Read)')).not.toBeInTheDocument()
  })

  it('expands a group and toggles single scopes', () => {
    const onToggle = vi.fn<(...a: any[]) => any>()
    render(<ScopeGrid selected={['products:read']} onToggle={onToggle} allowedKeys={allowed} />)
    fireEvent.click(screen.getByRole('button', { name: /Catalogue/ }))
    const read = screen.getByRole('button', { name: /Products \(Read\)/ })
    const write = screen.getByRole('button', { name: /Products \(Write\)/ })
    expect(read).toHaveAttribute('aria-pressed', 'true')
    expect(write).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(write)
    expect(onToggle).toHaveBeenCalledWith('products:write')
  })

  it('group All toggles only the missing keys, then None when complete', () => {
    const onToggle = vi.fn<(...a: any[]) => any>()
    const { rerender } = render(<ScopeGrid selected={['products:read']} onToggle={onToggle} allowedKeys={allowed} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'All' })[0])
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle.mock.calls[0][0]).toBe('products:write')
    onToggle.mockClear()
    rerender(<ScopeGrid selected={['products:read', 'products:write']} onToggle={onToggle} allowedKeys={allowed} />)
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('filters by search, auto-expands matches, and shows an empty message', () => {
    render(<ScopeGrid selected={[]} onToggle={() => {}} allowedKeys={allowed} />)
    const box = screen.getByPlaceholderText('Find a permission')
    fireEvent.change(box, { target: { value: 'shipment' } })
    expect(screen.getByRole('button', { name: /Orders \(Read\)/ })).toBeInTheDocument()
    expect(screen.queryByText('Catalogue')).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'zzzz-nothing' } })
    expect(screen.getByText(/No permission matches/)).toBeInTheDocument()
  })

  it('renders Select All / Clear All only when handlers are given', () => {
    const onSelectAll = vi.fn<(...a: any[]) => any>()
    const onClearAll = vi.fn<(...a: any[]) => any>()
    const { rerender } = render(<ScopeGrid selected={[]} onToggle={() => {}} allowedKeys={allowed} />)
    expect(screen.queryByRole('button', { name: 'Select All' })).not.toBeInTheDocument()
    rerender(<ScopeGrid selected={[]} onToggle={() => {}} onSelectAll={onSelectAll} onClearAll={onClearAll} allowedKeys={allowed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))
    expect(onSelectAll).toHaveBeenCalledTimes(1)
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('shows the full catalogue (more groups) when allowedKeys is omitted', () => {
    render(<ScopeGrid selected={[]} onToggle={() => {}} />)
    expect(screen.getAllByRole('button', { name: 'All' }).length).toBeGreaterThan(3)
  })
})
