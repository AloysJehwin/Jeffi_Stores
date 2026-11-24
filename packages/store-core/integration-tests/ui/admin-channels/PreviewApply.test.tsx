import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import PreviewApply from '@/components/admin/channels/PreviewApply'

const reply = (ok: boolean, data: unknown) => ({ ok, json: async () => data })

describe('PreviewApply', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  const payload = { sku: 'A1', price: 99 }
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('previews first with before/after and applies on confirm', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, { ok: true, preview: true, summary: 'Update 1 price', before: { price: 80 }, after: 120, problems: [] }))
    fetchMock.mockResolvedValueOnce(reply(true, { ok: true, preview: false, summary: 'Updated 1 price', problems: [] }))
    const onDone = vi.fn()
    render(<PreviewApply writeScope="amazon:write" endpoint="/api/amz" payload={payload} onClose={() => {}} onDone={onDone} applyLabel="Push" />)
    expect(screen.getByText('Checking the change...')).toBeInTheDocument()
    expect(await screen.findByText('Update 1 price')).toBeInTheDocument()
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ...payload, preview: true })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Updated 1 price'))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...payload, preview: false })
    expect(showToast).toHaveBeenCalledWith('Updated 1 price. Saved to the change history.', 'success')
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })

  it('lists validation problems and blocks Apply', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, { ok: false, preview: true, summary: 'Cannot apply', problems: ['Price is below cost'] }))
    render(<PreviewApply writeScope="amazon:write" endpoint="/api/amz" payload={payload} onClose={() => {}} />)
    expect(await screen.findByText('Price is below cost')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('shows a preview failure from the server error', async () => {
    fetchMock.mockResolvedValueOnce(reply(false, { error: 'Channel down' }))
    render(<PreviewApply writeScope="amazon:write" endpoint="/api/amz" payload={payload} onClose={() => {}} />)
    expect(await screen.findByText('Channel down')).toBeInTheDocument()
  })

  it('disables Apply without write permission', async () => {
    canWrite = false
    fetchMock.mockResolvedValueOnce(reply(true, { ok: true, preview: true, summary: 'Ready', problems: [] }))
    render(<PreviewApply writeScope="amazon:write" endpoint="/api/amz" payload={payload} onClose={() => {}} />)
    await screen.findByText('Ready')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('toasts an apply failure and calls onClose from Cancel', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, { ok: true, preview: true, summary: 'Ready', problems: [] }))
    fetchMock.mockResolvedValueOnce(reply(false, { error: 'Rejected' }))
    const onClose = vi.fn()
    render(<PreviewApply writeScope="amazon:write" endpoint="/api/amz" payload={payload} onClose={onClose} />)
    await screen.findByText('Ready')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rejected', 'error'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
