import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import ServicesClient from '@controller/app/(ecom)/ecom/dashboard/services/ServicesClient'

const prices = {
  messages: { whatsapp: 0.85, sms: 0.2, email: 0.1 },
  documents: { invoice: 2, quotation: 2, receipt: 1, packing_slip: 1, label: 1, purchase_order: 2 },
  media: 0.5,
}
const states = (m: any = { status: 'off' }, d: any = { status: 'off' }) => ({ messaging: m, documents: d }) as any
const ready = { services: { messaging: { ready: true, todo: [] }, documents: { ready: true, todo: [] } }, items: {} } as any
const blockedKyb = {
  services: { messaging: { ready: false, todo: ['pan', 'website'] }, documents: { ready: true, todo: [] } },
  items: { pan: { state: 'missing', problem: 'Add your PAN' }, website: { state: 'checking' } },
} as any

describe('ServicesClient', () => {
  it('shows a card per service with status, per-send prices and the Add button', () => {
    render(<ServicesClient states={states()} prices={prices} kyb={ready} />)
    expect(screen.getByText('Messaging API')).toBeInTheDocument()
    expect(screen.getByText('Documents API')).toBeInTheDocument()
    expect(screen.getAllByText('Not added')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Add Messaging' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add Documents' })).toBeEnabled()
    expect(screen.getByText('Per send, charged from your wallet.')).toBeInTheDocument()
    expect(screen.getByText('Per document, charged from your wallet.')).toBeInTheDocument()
  })

  it('adds a service and refreshes', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    render(<ServicesClient states={states()} prices={prices} kyb={ready} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Messaging' }))
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(f.mock.calls[0][0]).toBe('/api/ecom/services/add')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ services: ['messaging'] })
  })

  it('shows the API error if adding fails', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'Try later' }) }))
    render(<ServicesClient states={states()} prices={prices} kyb={ready} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Documents' }))
    expect(await screen.findByText('Try later')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('blocks adding until the business is verified, listing what is missing', () => {
    render(<ServicesClient states={states()} prices={prices} kyb={blockedKyb} />)
    expect(screen.getByText('Verify your business first')).toBeInTheDocument()
    expect(screen.getByText('Messaging needs these before Jeffi can switch it on:')).toBeInTheDocument()
    expect(screen.getByText(/Add your PAN/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Messaging' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Verify your business' })).toHaveAttribute('href', '/dashboard/business?for=messaging')
  })

  it('shows the missing items when the server answers kyb_required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'kyb_required', missing: { documents: [{ item: 'gst', label: 'GST registration', problem: 'No GSTIN' }] } }) }),
    )
    render(<ServicesClient states={states()} prices={prices} kyb={ready} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Documents' }))
    expect(await screen.findByText(/No GSTIN/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Documents' })).toBeDisabled()
  })

  it('shows live, pending and rejected states with their next steps', () => {
    render(<ServicesClient states={states({ status: 'live' }, { status: 'pending' })} prices={prices} kyb={ready} />)
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Messaging' })).toHaveAttribute('href', '/dashboard/messaging')
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.getByText(/Jeffi is reviewing it, usually within 1–2 business days/)).toBeInTheDocument()
  })

  it('shows a rejected service with the reviewer note and a request-again button', () => {
    render(<ServicesClient states={states({ status: 'rejected', note: 'Use case unclear' })} prices={prices} kyb={ready} />)
    expect(screen.getByText('Not approved')).toBeInTheDocument()
    expect(screen.getByText('Use case unclear')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request again' })).toBeInTheDocument()
  })

  it('compact mode hides the services already live and summarises what is owed', () => {
    render(<ServicesClient states={states({ status: 'live' }, { status: 'off' })} prices={prices} compact kyb={{ ...blockedKyb, services: { ...blockedKyb.services, documents: { ready: false, todo: ['pan'] } } }} />)
    expect(screen.queryByText('Messaging API')).toBeNull()
    expect(screen.getByText('One thing to do before you can add Documents.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/dashboard/services')
  })

  it('renders nothing in compact mode when every service is live', () => {
    const { container } = render(<ServicesClient states={states({ status: 'live' }, { status: 'live' })} prices={prices} compact kyb={ready} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('loads the KYB itself when none is given and keeps Add disabled while it loads', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ kyb: blockedKyb }) })
    vi.stubGlobal('fetch', f)
    render(<ServicesClient states={states()} prices={prices} />)
    expect(screen.getByRole('button', { name: 'Add Messaging' })).toBeDisabled()
    expect(await screen.findByText('Messaging needs these before Jeffi can switch it on:')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/kyb')
  })
})
