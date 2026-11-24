import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/admin/data-source',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))

const runSheetSync = vi.fn()
vi.mock('@admin/app/(admin)/admin/data-source/_components/OverviewTab', () => ({ default: ({ onGoto }: any) => <div>overview-tab<button onClick={() => onGoto('history')}>goto-history</button></div> }))
vi.mock('@admin/app/(admin)/admin/data-source/_components/ImportTab', () => ({ default: () => <div>import-tab</div> }))
vi.mock('@admin/app/(admin)/admin/data-source/_components/HistoryTab', () => ({ default: () => <div>history-tab</div> }))
vi.mock('@admin/app/(admin)/admin/data-source/_components/SheetTab', () => ({
  default: ({ gsheet }: any) => <div>sheet-tab:{gsheet.state}</div>,
  runSheetSync: (...a: any[]) => runSheetSync(...a),
}))

import DataSourceClient from '@admin/app/(admin)/admin/data-source/_components/DataSourceClient'

const connected: any = { enabled: true, connected: true, state: 'connected', spreadsheetId: 's1', lastSync: null }
const fetchMock = vi.fn()

describe('DataSourceClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => connected })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('opens on Overview with four tabs and refreshes the sheet status', async () => {
    render(asAdmin(<DataSourceClient />))
    expect(screen.getByText('overview-tab')).toBeInTheDocument()
    for (const l of ['Overview', 'Import file', 'Google Sheet', 'History']) expect(screen.getByRole('tab', { name: l })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/data-source/google/status', { credentials: 'include' }))
  })

  it('selecting a tab replaces the URL; Overview drops the param', async () => {
    sp = new URLSearchParams('tab=history')
    render(asAdmin(<DataSourceClient />))
    expect(screen.getByText('history-tab')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Google Sheet' }))
    expect(replace).toHaveBeenCalledWith('/admin/data-source?tab=google_sheet', { scroll: false })
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(replace).toHaveBeenLastCalledWith('/admin/data-source', { scroll: false })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('the overview can jump to another tab', async () => {
    render(asAdmin(<DataSourceClient />))
    fireEvent.click(screen.getByText('goto-history'))
    expect(replace).toHaveBeenCalledWith('/admin/data-source?tab=history', { scroll: false })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  it('shows the Upload and Template actions, but Upload only with write access', async () => {
    const { unmount } = render(asAdmin(<DataSourceClient />))
    expect(await screen.findByRole('link', { name: 'Download Excel template' })).toHaveAttribute('href', '/api/admin/data-source/template')
    expect(screen.getByRole('button', { name: 'Upload a spreadsheet' })).toBeInTheDocument()
    unmount()
    render(asMember(<DataSourceClient />, ['products:read']))
    expect(await screen.findByRole('link', { name: 'Download Excel template' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload a spreadsheet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync Google Sheet now' })).not.toBeInTheDocument()
  })

  it('Sync queues a sheet sync and toasts the row count with the skipped note', async () => {
    runSheetSync.mockResolvedValue({ ok: true, data: { totalRows: 40, invalid: 3 } })
    render(asAdmin(<DataSourceClient initialGsheet={connected} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Google Sheet now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Sync queued: 40 row(s) from the sheet. 3 row(s) already have problems and will be skipped.', 'success'))
  })

  it('Sync failure toasts the error', async () => {
    runSheetSync.mockResolvedValue({ ok: false, status: 502, data: { error: 'Sheet unreachable' } })
    render(asAdmin(<DataSourceClient initialGsheet={connected} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Sync Google Sheet now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Sheet unreachable', 'error'))
  })

  it('disables Sync while a sheet sync is running', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...connected, lastSync: { status: 'running' } }) })
    render(asAdmin(<DataSourceClient initialGsheet={{ ...connected, lastSync: { status: 'running' } }} />))
    const btn = await screen.findByRole('button', { name: 'Sync Google Sheet now' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Syncing')
  })

  it('Upload switches to the import tab', async () => {
    render(asAdmin(<DataSourceClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Upload a spreadsheet' }))
    expect(replace).toHaveBeenCalledWith('/admin/data-source?tab=import', { scroll: false })
  })

  it('a successful Google connect return toasts once and clears the params', async () => {
    sp = new URLSearchParams('tab=google_sheet&connected=1')
    render(asAdmin(<DataSourceClient />))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Google account connected.', 'success'))
    expect(replace).toHaveBeenCalledWith('/admin/data-source?tab=google_sheet', { scroll: false })
  })

  it('a failed Google connect return maps the error code', async () => {
    sp = new URLSearchParams('connected=0&error=access_denied')
    render(asAdmin(<DataSourceClient />))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Google sign-in was cancelled.', 'error'))
    expect(replace).toHaveBeenCalledWith('/admin/data-source', { scroll: false })
  })
})
