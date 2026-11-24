import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

import BillingReconcile from '@controller/components/admin/ecom/tabs/BillingReconcile'

const view = () =>
  render(
    <ToastProvider>
      <BillingReconcile tenantId="t1" />
    </ToastProvider>,
  )
const period = () => screen.getByLabelText('Billing period') as HTMLInputElement
const upload = (csv: string) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([csv], 'bill.csv', { type: 'text/csv' })] } })
}
const csv = 'Waybill,Total Charged\n"AWB1","₹95.50"\nAWB2,120\n,50\nAWB3,abc'

describe('BillingReconcile', () => {
  it('keeps the upload disabled until the period is YYYY-MM', () => {
    view()
    const btn = screen.getByRole('button', { name: /Upload billing CSV/ })
    expect(btn).toBeDisabled()
    fireEvent.change(period(), { target: { value: 'Aug 2026' } })
    expect(btn).toBeDisabled()
    fireEvent.change(period(), { target: { value: '2026-08' } })
    expect(btn).toBeEnabled()
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false)
  })

  it('parses waybill and amount columns, posts the rows and shows the summary', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ period: '2026-08', summary: { matched: 2, unmatched: 1 } }) })
    vi.stubGlobal('fetch', fetchMock)
    view()
    fireEvent.change(period(), { target: { value: ' 2026-08 ' } })
    upload(csv)
    expect(await screen.findByText('Reconciled 3 rows for 2026-08.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/ecom/t1/wallet/reconcile-billing')
    expect(JSON.parse(init.body)).toEqual({
      period: '2026-08',
      rows: [
        { awb: 'AWB1', billedAmount: 95.5 },
        { awb: 'AWB2', billedAmount: 120 },
        { awb: 'AWB3', billedAmount: 0 },
      ],
    })
    expect(screen.getByText('matched')).toBeInTheDocument()
    expect(screen.getByText('unmatched')).toBeInTheDocument()
  })

  it('rejects a CSV without waybill and amount columns, without calling the API', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    view()
    fireEvent.change(period(), { target: { value: '2026-08' } })
    upload('Name,City\nA,B')
    expect(await screen.findByText(/No AWB \/ charge rows found/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the API error when reconciliation fails', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Period locked' }) }))
    view()
    fireEvent.change(period(), { target: { value: '2026-08' } })
    upload(csv)
    expect(await screen.findByText('Period locked')).toBeInTheDocument()
  })

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('offline')))
    view()
    fireEvent.change(period(), { target: { value: '2026-08' } })
    upload(csv)
    expect(await screen.findByText('Could not read or upload the CSV.')).toBeInTheDocument()
  })
})
