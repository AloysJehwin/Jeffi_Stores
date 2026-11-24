import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import FilterValueHelp from '@/components/admin/FilterValueHelp'

const values = [
  { value: 'Cotton', count: 12 },
  { value: 'Linen', count: 3 },
]

function Harness(props: Partial<React.ComponentProps<typeof FilterValueHelp>> & { initial?: string; spy?: (v: string) => void }) {
  const [v, setV] = useState(props.initial ?? '')
  return (
    <FilterValueHelp
      field="material"
      label="Material"
      {...props}
      value={v}
      onChange={n => {
        props.spy?.(n)
        setV(n)
      }}
    />
  )
}

describe('FilterValueHelp', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ values, hasMore: false }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  const open = async () => {
    fireEvent.click(screen.getByTitle('Browse Material values'))
    await screen.findByText('Cotton')
  }

  it('shows the placeholder, or Any <label>, when nothing is selected', () => {
    const first = render(<Harness />)
    expect(screen.getByText('Any Material')).toBeInTheDocument()
    first.unmount()
    render(<Harness placeholder="Pick a fabric" />)
    expect(screen.getByText('Pick a fabric')).toBeInTheDocument()
  })

  it('shows selected values as removable tags without opening the dialog', () => {
    const spy = vi.fn()
    render(<Harness initial="Cotton|Linen" spy={spy} />)
    expect(screen.getByText('Cotton')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cotton').querySelector('button')!)
    expect(spy).toHaveBeenCalledWith('Linen')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens on click, loads values with counts and the noun heading', async () => {
    render(<Harness noun="Orders" context="status=paid" />)
    await open()
    expect(screen.getByText('Select Material')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Orders' })).toBeInTheDocument()
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/api/admin/products/attribute-values')
    expect(url.searchParams.get('field')).toBe('material')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('context')).toBe('status=paid')
  })

  it('uses a custom endpoint', async () => {
    render(<Harness endpoint="/api/admin/orders/values" />)
    await open()
    expect(String(fetchMock.mock.calls[0][0]).startsWith('/api/admin/orders/values?')).toBe(true)
  })

  it('toggles values in multi mode and reports the count on Apply', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await open()
    fireEvent.click(screen.getByText('Cotton'))
    fireEvent.click(screen.getByText('Linen'))
    expect(spy).toHaveBeenLastCalledWith('Cotton|Linen')
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cotton', { selector: 'td' }))
    expect(spy).toHaveBeenLastCalledWith('Linen')
    fireEvent.click(screen.getByRole('button', { name: /Apply \(1 selected\)/ }))
    expect(screen.queryByText('Select Material')).toBeNull()
  })

  it('single mode picks one value and closes', async () => {
    const spy = vi.fn()
    render(<Harness multi={false} spy={spy} />)
    await open()
    fireEvent.click(screen.getByText('Linen'))
    expect(spy).toHaveBeenCalledWith('Linen')
    expect(screen.queryByText('Select Material')).toBeNull()
  })

  it('single mode clears when the current value is picked again', async () => {
    const spy = vi.fn()
    render(<Harness multi={false} initial="Linen" spy={spy} />)
    await open()
    fireEvent.click(screen.getByText('Linen', { selector: 'td' }))
    expect(spy).toHaveBeenCalledWith('')
  })

  it('Clear and Clear all empty the selection', async () => {
    const spy = vi.fn()
    render(<Harness initial="Cotton|Linen" spy={spy} />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(spy).toHaveBeenLastCalledWith('')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('searches after a debounce', async () => {
    render(<Harness />)
    await open()
    fireEvent.change(screen.getByPlaceholderText('Search Material…'), { target: { value: 'lin' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('search=lin'))).toBe(true))
  })

  it('loads more pages when the API says there are more', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ values, hasMore: true }) })
      .mockResolvedValue({ ok: true, json: async () => ({ values: [{ value: 'Silk', count: 1 }], hasMore: false }) })
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Silk')).toBeInTheDocument()
    expect(screen.getByText('Cotton')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('page=2'))).toBe(true)
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ values: [] }) })
    render(<Harness />)
    fireEvent.click(screen.getByTitle('Browse Material values'))
    expect(await screen.findByText('No values found')).toBeInTheDocument()
  })

  it('closes from the backdrop but not from inside the dialog', async () => {
    render(<Harness />)
    await open()
    fireEvent.click(screen.getByText('Select Material'))
    expect(screen.getByText('Select Material')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Select Material').closest('.fixed')!)
    expect(screen.queryByText('Select Material')).toBeNull()
  })
})
