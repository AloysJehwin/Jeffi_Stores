import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import MarketplaceReturns from '@/components/admin/marketplace/MarketplaceReturns'
import { renderAs, res, routeFetch, bodyOf, callsTo, stubWide } from './marketplace-kit'

// MarketplaceReturns: open / all returns for one marketplace, with QC actions that ask for a note first.
// fetch, next/navigation, the prompt/confirm contexts and the toast are stubbed.
const showToast = vi.fn<(...a: any[]) => any>()
const prompt = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ usePrompt: () => prompt, useConfirm: () => async () => true }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/myntra',
  useSearchParams: () => new URLSearchParams(),
}))

const ret = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  external_return_id: 'RET-1',
  external_order_id: 'MYN-100',
  order_id: 'o1',
  order_number: '1001',
  return_type: 'customer',
  reason: 'Wrong size',
  refund_amount: '499',
  status: 'received',
  restocked: false,
  updated_at: '2026-01-02T10:00:00.000Z',
  ...over,
})

const CONSOLE = '/api/admin/myntra/console'

describe('MarketplaceReturns', () => {
  beforeEach(() => {
    showToast.mockClear()
    prompt.mockReset()
    stubWide()
  })

  it('lists returns with order link, type, status and stock state', async () => {
    const f = routeFetch([
      [CONSOLE, res({ returns: [ret(), ret({ id: 'r2', external_return_id: 'RET-2', return_type: 'rto', status: 'qc_passed', restocked: true }), ret({ id: 'r3', external_return_id: 'RET-3', status: 'qc_failed' })] })],
    ])
    renderAs(<MarketplaceReturns channel="myntra" />)
    expect(await screen.findByText('RET-1')).toBeInTheDocument()
    expect(callsTo(f, CONSOLE)[0][0]).toContain('view=returns&scope=open')
    expect(screen.getAllByRole('link', { name: '#1001' })[0]).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(screen.getByText('RTO')).toBeInTheDocument()
    expect(screen.getByText('QC passed')).toBeInTheDocument()
    expect(screen.getByText('Restocked')).toBeInTheDocument()
    expect(screen.getByText('Not restocked')).toBeInTheDocument()
  })

  it('reloads with scope=all when All is chosen', async () => {
    const f = routeFetch([[CONSOLE, res({ returns: [] })]])
    renderAs(<MarketplaceReturns channel="myntra" />)
    expect(await screen.findByText('No open returns')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByText('No returns yet')).toBeInTheDocument()
    expect(callsTo(f, CONSOLE).at(-1)![0]).toContain('scope=all')
  })

  it('shows the load error', async () => {
    routeFetch([[CONSOLE, res({ error: 'Boom' }, false)]])
    renderAs(<MarketplaceReturns channel="myntra" />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
  })

  it('marks QC ok after a note, posting the action and reloading', async () => {
    prompt.mockResolvedValue('  looks fine ')
    const f = routeFetch([
      [CONSOLE, res({ returns: [ret()] })],
      ['/returns/action', res({ message: 'Stock restored.' })],
    ])
    renderAs(<MarketplaceReturns channel="myntra" />)
    await screen.findByText('RET-1')
    fireEvent.click(screen.getByRole('button', { name: 'Received / QC ok' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Stock restored.', 'success'))
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Mark QC ok' }))
    expect(bodyOf(f, '/returns/action')).toEqual({ id: 'r1', action: 'qc_pass', note: 'looks fine' })
    await waitFor(() => expect(callsTo(f, CONSOLE).length).toBeGreaterThan(1))
  })

  it('marks QC failed with no note when left blank', async () => {
    prompt.mockResolvedValue('')
    const f = routeFetch([
      [CONSOLE, res({ returns: [ret()] })],
      ['/returns/action', res({ message: 'Recorded.' })],
    ])
    renderAs(<MarketplaceReturns channel="myntra" />)
    await screen.findByText('RET-1')
    fireEvent.click(screen.getByRole('button', { name: 'QC failed' }))
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(bodyOf(f, '/returns/action')).toEqual({ id: 'r1', action: 'qc_fail' })
  })

  it('does nothing when the note prompt is cancelled', async () => {
    prompt.mockResolvedValue(null)
    const f = routeFetch([[CONSOLE, res({ returns: [ret()] })]])
    renderAs(<MarketplaceReturns channel="myntra" />)
    await screen.findByText('RET-1')
    fireEvent.click(screen.getByRole('button', { name: 'Received / QC ok' }))
    await waitFor(() => expect(prompt).toHaveBeenCalled())
    expect(callsTo(f, '/returns/action')).toHaveLength(0)
  })

  it('toasts the server error when the action fails', async () => {
    prompt.mockResolvedValue('x')
    routeFetch([
      [CONSOLE, res({ returns: [ret()] })],
      ['/returns/action', res({ error: 'Already closed' }, false)],
    ])
    renderAs(<MarketplaceReturns channel="myntra" />)
    await screen.findByText('RET-1')
    fireEvent.click(screen.getByRole('button', { name: 'Received / QC ok' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already closed', 'error'))
  })

  it('offers QC actions only on open returns', async () => {
    routeFetch([[CONSOLE, res({ returns: [ret({ status: 'qc_passed' })] })]])
    renderAs(<MarketplaceReturns channel="myntra" />)
    await screen.findByText('RET-1')
    expect(screen.queryByRole('button', { name: 'Received / QC ok' })).toBeNull()
  })

  it('hides QC actions for a read-only admin', async () => {
    routeFetch([[CONSOLE, res({ returns: [ret()] })]])
    renderAs(<MarketplaceReturns channel="myntra" />, 'reader')
    await screen.findByText('RET-1')
    expect(screen.queryByRole('button', { name: 'Received / QC ok' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'QC failed' })).toBeNull()
  })
})
