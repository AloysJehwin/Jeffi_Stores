import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import SettlementsPanel from '@/components/admin/marketplace/SettlementsPanel'
import { renderAs, res, routeFetch, callsTo } from './marketplace-kit'

// SettlementsPanel: payouts imported from the portal's settlement reports, matched to orders, plus what is
// still receivable. Importing is a two-step dialog: preview (with column mapping), then commit.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))

const DAY = 86400_000
const view = (over: Record<string, unknown> = {}) => ({
  totals: { net: 50000, gross: 60000, commission: 5000, fees: 1000, tax: 500, count: 2 },
  receivable: { unsettledValue: 20000, unsettledOrders: 3, overdueOrders: 1, oldestUnsettledAt: '2025-12-01T00:00:00.000Z' },
  settlements: [
    { id: 's1', settled_on: '2026-01-10', settlement_ref: 'REF-1', file_name: 'jan.xlsx', gross: '30000', commission: '3000', fees: '500', tax_withheld: '200', refunds: '0', net_amount: '26300', lines: 10, matched: 9 },
  ],
  unsettled: [{ external_order_id: 'MYN-5', order_number: '1005', total: '999', delivered_at: new Date(Date.now() - 30 * DAY).toISOString() }],
  mapping: null,
  fields: [
    { key: 'net', label: 'Net amount' },
    { key: 'ref', label: 'Reference' },
  ],
  ...over,
})

const previewBody = (over: Record<string, unknown> = {}) => ({
  fields: [
    { key: 'net', label: 'Net amount' },
    { key: 'ref', label: 'Reference' },
  ],
  headers: ['Ref', 'Net'],
  mapping: { ref: 'Ref', net: 'Net' },
  problems: [],
  rows: 12,
  samples: { Ref: 'R-1', Net: '100' },
  preview: [],
  errors: [],
  payouts: [{ ref: 'REF-9', lines: 2, gross: 100, commission: 10, fees: 0, net: 90 }],
  ...over,
})

const BASE = '/api/admin/myntra/settlements'

function importFile(name = 'report.xlsx') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], name)] } })
}

describe('SettlementsPanel', () => {
  beforeEach(() => showToast.mockClear())

  it('shows the loading state, then KPIs, payouts and unsettled orders', async () => {
    const f = routeFetch([[BASE, res(view())]])
    renderAs(<SettlementsPanel channel="myntra" />)
    expect(await screen.findByText('REF-1')).toBeInTheDocument()
    expect(callsTo(f, BASE)[0][0]).toMatch(/\?from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d/)
    expect(screen.getByText('Settled to bank')).toBeInTheDocument()
    expect(screen.getByText('2 payout(s) in this period')).toBeInTheDocument()
    expect(screen.getByText('10.0% of sales')).toBeInTheDocument()
    expect(screen.getByText('1 order(s) unsettled 20+ days')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('Delivered, not settled (3)')).toBeInTheDocument()
    expect(screen.getByText('1005')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument()
    expect(screen.getByText(/Oldest unsettled delivery/)).toBeInTheDocument()
  })

  it('explains empty payouts and an all-settled receivable', async () => {
    routeFetch([[BASE, res(view({ settlements: [], unsettled: [], receivable: { unsettledValue: 0, unsettledOrders: 0, overdueOrders: 0, oldestUnsettledAt: null } }))]])
    renderAs(<SettlementsPanel channel="myntra" />)
    expect(await screen.findByText(/No Myntra payouts in this period/)).toBeInTheDocument()
    expect(screen.getByText('Every delivered order has a settlement line.')).toBeInTheDocument()
    expect(screen.getByText('0 delivered order(s) not yet settled')).toBeInTheDocument()
  })

  it('mentions the reused column mapping when one is saved', async () => {
    routeFetch([[BASE, res(view({ mapping: { net: 'Net' } }))]])
    renderAs(<SettlementsPanel channel="myntra" />)
    expect(await screen.findByText(/column mapping from your last import is reused/)).toBeInTheDocument()
  })

  it('shows a banner when the first load fails', async () => {
    routeFetch([[BASE, res({ error: 'Could not reach settlements' }, false)]])
    renderAs(<SettlementsPanel channel="myntra" />)
    expect(await screen.findByText('Could not reach settlements')).toBeInTheDocument()
  })

  it('reloads for another range and on refresh', async () => {
    const f = routeFetch([[BASE, res(view())]])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    fireEvent.click(screen.getByRole('button', { name: '30d' }))
    await waitFor(() => expect(callsTo(f, BASE)).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(callsTo(f, BASE)).toHaveLength(3))
  })

  it('hides the import button for a read-only admin', async () => {
    routeFetch([[BASE, res(view())]])
    renderAs(<SettlementsPanel channel="myntra" />, 'reader')
    await screen.findByText('REF-1')
    expect(screen.queryByRole('button', { name: 'Import a settlement report' })).toBeNull()
  })

  it('previews a chosen report in a dialog and commits it, then reloads', async () => {
    const f = routeFetch([
      [/settlements\/import/, (_u: string, init?: RequestInit) => ((init?.body as FormData).get('commit') ? res({ ok: true, lines: 12, settlements: 1, matched: 12 }) : res(previewBody()))],
      [BASE, res(view())],
    ])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    importFile()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Import a Myntra settlement report')).toBeInTheDocument()
    expect(await within(dialog).findByText('1 payout(s), ₹90 settled')).toBeInTheDocument()
    expect(within(dialog).getByText('REF-9')).toBeInTheDocument()
    expect(within(dialog).getByText('report.xlsx · 12 rows')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 payout(s)' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Imported 12 line(s) in 1 payout(s); 12 matched to orders.', 'success'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsTo(f, /settlements\/import/)).toHaveLength(2)
    expect(callsTo(f, BASE).length).toBeGreaterThan(1)
  })

  it('blocks the import and shows the problems when the mapping is incomplete', async () => {
    routeFetch([
      [/settlements\/import/, res(previewBody({ problems: ['No net amount column.'], payouts: [] }))],
      [BASE, res(view())],
    ])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    importFile()
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('No net amount column.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Import 0 payout(s)' })).toBeDisabled()
  })

  it('re-checks the preview after the mapping is changed', async () => {
    const f = routeFetch([
      [/settlements\/import/, res(previewBody())],
      [BASE, res(view())],
    ])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    importFile()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('1 payout(s), ₹90 settled')
    fireEvent.click(within(dialog).getAllByRole('combobox')[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Ref' }))
    expect(within(dialog).getByText(/Check the mapping to see the payouts it produces/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check mapping' }))
    await waitFor(() => expect(callsTo(f, /settlements\/import/)).toHaveLength(2))
    const form = callsTo(f, /settlements\/import/)[1][1]!.body as FormData
    expect(JSON.parse(String(form.get('mapping'))).net).toBe('Ref')
  })

  it('shows the error when the report cannot be read, and Cancel closes the dialog', async () => {
    routeFetch([
      [/settlements\/import/, res({ error: 'Not a spreadsheet' }, false)],
      [BASE, res(view())],
    ])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    importFile('x.txt')
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Not a spreadsheet')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toasts an error when the commit fails', async () => {
    routeFetch([
      [/settlements\/import/, (_u: string, init?: RequestInit) => ((init?.body as FormData).get('commit') ? res({ error: 'Duplicate payout' }, false) : res(previewBody()))],
      [BASE, res(view())],
    ])
    renderAs(<SettlementsPanel channel="myntra" />)
    await screen.findByText('REF-1')
    importFile()
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 payout(s)' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Duplicate payout', 'error'))
  })
})
