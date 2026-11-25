import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import InventoryPanel from '@/components/admin/marketplace/InventoryPanel'
import { renderAs, res, routeFetch, bodyOf, callsTo } from './marketplace-kit'

// InventoryPanel: stock pushed to a marketplace (our stock less reserved and the safety buffer) per mapped
// listing; push-now and save-buffer are the two writes.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))

const row = (over: Record<string, unknown> = {}) => ({
  sku: 'SKU-1',
  title: 'Cordless Drill',
  listingStatus: 'live',
  available: 12,
  reserved: 2,
  desired: 8,
  pushedQty: 5,
  pushedAt: '2026-01-02T10:00:00.000Z',
  pushError: null,
  ourPrice: 999,
  listedPrice: 999,
  ...over,
})

const view = (over: Record<string, unknown> = {}) => ({
  buffer: 2,
  warehouse: 'WH-1',
  rows: [row()],
  totals: { rows: 1, pending: 1, errors: 0, drift: 0, neverPushed: 0 },
  lastRun: null,
  lastPushAt: '2026-01-02T10:00:00.000Z',
  ...over,
})

const URL = '/api/admin/myntra/stock'

describe('InventoryPanel', () => {
  beforeEach(() => showToast.mockClear())

  it('shows the loading skeleton, then KPIs and the listing table', async () => {
    routeFetch([[URL, res(view())]])
    renderAs(<InventoryPanel channel="myntra" />)
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('Warehouse WH-1')).toBeInTheDocument()
    expect(screen.getByText('Listings with stock')).toBeInTheDocument()
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
    expect(screen.getByText('Units held back')).toBeInTheDocument()
    expect(screen.getByLabelText('Units held back')).toHaveValue(2)
  })

  it('shows the error banner when stock cannot be loaded', async () => {
    routeFetch([[URL, res({ error: 'No connection' }, false)]])
    renderAs(<InventoryPanel channel="myntra" />)
    expect(await screen.findByText('No connection')).toBeInTheDocument()
  })

  it('warns when no warehouse is set, and explains the empty table', async () => {
    routeFetch([[URL, res(view({ warehouse: '', rows: [], totals: { rows: 0, pending: 0, errors: 0, drift: 0, neverPushed: 0 }, lastPushAt: null }))]])
    renderAs(<InventoryPanel channel="myntra" />)
    expect(await screen.findByText(/Add your Myntra warehouse ID/)).toBeInTheDocument()
    expect(screen.getByText('No warehouse set')).toBeInTheDocument()
    expect(screen.getByText(/No mapped listings yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push stock now' })).toBeDisabled()
  })

  it('flags price drift and push errors on a row', async () => {
    routeFetch([[URL, res(view({ rows: [row({ listedPrice: 899 }), row({ sku: 'SKU-2', title: 'Saw', pushError: 'Rejected' })] }))]])
    renderAs(<InventoryPanel channel="myntra" />)
    await screen.findByText('Cordless Drill')
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(document.querySelector('[title*="Listed at"]')).not.toBeNull()
  })

  it('pushes stock and toasts the counts, with a warning when some fail', async () => {
    const f = routeFetch([
      [URL, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ status: 'ok', counts: { changed: 4, failed: 1 }, errors: [{ message: 'Bad SKU' }] }) : res(view()))],
    ])
    renderAs(<InventoryPanel channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByRole('button', { name: 'Push stock now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Pushed 4 change(s); 1 failed.', 'warning'))
    expect(callsTo(f, URL).some(([, init]) => (init as RequestInit)?.method === 'POST')).toBe(true)
  })

  it('toasts an error when the push fails', async () => {
    routeFetch([[URL, (_u: string, init?: RequestInit) => (init?.method === 'POST' ? res({ error: 'Portal down' }, false) : res(view()))]])
    renderAs(<InventoryPanel channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByRole('button', { name: 'Push stock now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Portal down', 'error'))
  })

  it('saves a changed buffer with PUT, and rejects an invalid one client-side', async () => {
    const f = routeFetch([[URL, (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? res({ ok: true }) : res(view()))]])
    renderAs(<InventoryPanel channel="myntra" />)
    await screen.findByText('Cordless Drill')
    const save = screen.getByRole('button', { name: 'Save buffer' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Units held back'), { target: { value: '5000' } })
    fireEvent.click(save)
    expect(showToast).toHaveBeenCalledWith('The buffer is a whole number from 0 to 1000.', 'error')
    expect(callsTo(f, URL).filter(([, i]) => (i as RequestInit)?.method === 'PUT')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Units held back'), { target: { value: '5' } })
    fireEvent.click(save)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Myntra buffer set to 5. It applies from the next push.', 'success'))
    expect(bodyOf(f, URL, 1)).toEqual({ buffer: 5 })
  })

  it('shows the last run summary', async () => {
    routeFetch([[URL, res(view({ lastRun: { started_at: '2026-01-02T10:00:00.000Z', status: 'ok', counts: { changed: 3, failed: 0 }, errors: [{ message: 'One SKU skipped' }] } }))]])
    renderAs(<InventoryPanel channel="myntra" />)
    expect(await screen.findByText(/Last run .*: ok · changed 3 · One SKU skipped/)).toBeInTheDocument()
  })

  it('hides the push and buffer controls for a read-only admin', async () => {
    routeFetch([[URL, res(view())]])
    renderAs(<InventoryPanel channel="myntra" />, 'reader')
    await screen.findByText('Cordless Drill')
    expect(screen.queryByRole('button', { name: 'Push stock now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save buffer' })).toBeNull()
    expect(screen.getByLabelText('Units held back')).toBeDisabled()
  })
})
