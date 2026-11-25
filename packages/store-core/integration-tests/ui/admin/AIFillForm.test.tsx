import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canUseAi = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanUseAi: () => canUseAi }))

import AIFillForm from '@/components/admin/AIFillForm'

const fields = [{ name: 'code', label: 'Code', type: 'text' as const }]

function mockFetch(res: { ok: boolean; body: unknown }) {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: res.ok, json: async () => res.body })
  vi.stubGlobal('fetch', f)
  return f
}

describe('AIFillForm', () => {
  beforeEach(() => {
    canUseAi = true
  })

  it('renders nothing when the admin cannot use AI', () => {
    canUseAi = false
    const { container } = render(<AIFillForm fields={fields} onFill={vi.fn()} scope="coupons:write" />)
    expect(container.firstChild).toBeNull()
  })

  it('disables the button until a scenario is typed', () => {
    render(<AIFillForm fields={fields} onFill={vi.fn()} scope="coupons:write" />)
    const btn = screen.getByRole('button', { name: 'Fill with AI' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10% off' } })
    expect(btn).toBeEnabled()
  })

  it('posts the scenario with context and passes the AI fields to onFill', async () => {
    const f = mockFetch({ ok: true, body: { fields: { code: 'SAVE10' } } })
    const onFill = vi.fn()
    render(<AIFillForm fields={fields} onFill={onFill} scope="coupons:write" context="Coupon form" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' 10% off ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fill with AI' }))
    await waitFor(() => expect(onFill).toHaveBeenCalledWith({ code: 'SAVE10' }))
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/admin/ai-fill-form')
    expect(JSON.parse(init.body)).toEqual({ scenario: 'Coupon form\n10% off', fields, scope: 'coupons:write' })
    expect(await screen.findByText('Filled!')).toBeInTheDocument()
  })

  it('submits on Enter', async () => {
    const f = mockFetch({ ok: true, body: { fields: {} } })
    render(<AIFillForm fields={fields} onFill={vi.fn()} scope="coupons:write" />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
  })

  it('shows the API error and does not call onFill', async () => {
    mockFetch({ ok: false, body: { error: 'Quota exceeded' } })
    const onFill = vi.fn()
    render(<AIFillForm fields={fields} onFill={onFill} scope="coupons:write" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fill with AI' }))
    expect(await screen.findByText('Quota exceeded')).toBeInTheDocument()
    expect(onFill).not.toHaveBeenCalled()
  })

  it('shows a network error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('down')))
    render(<AIFillForm fields={fields} onFill={vi.fn()} scope="coupons:write" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fill with AI' }))
    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })

  it('shows the loading label while the request is pending', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>(() => new Promise(() => {})))
    render(<AIFillForm fields={fields} onFill={vi.fn()} scope="coupons:write" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fill with AI' }))
    expect(await screen.findByText(/Filling/)).toBeInTheDocument()
  })
})
