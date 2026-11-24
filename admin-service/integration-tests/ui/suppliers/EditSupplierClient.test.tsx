import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin } from '../_support'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/suppliers/s1/edit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/MobileEditBlock', () => ({ default: ({ children }: any) => <>{children}</> }))
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: ({ status }: any) => <span>autosave:{status}</span> }))
vi.mock('@/components/admin/drafts/MergeDialog', () => ({
  default: ({ conflicts, onDone }: any) => (
    <div>
      <p>merge:{conflicts.length}</p>
      <button onClick={() => onDone()}>merge-done</button>
    </div>
  ),
}))
const resnapshot = vi.fn()
vi.mock('@admin/app/(admin)/admin/suppliers/[id]/edit/actions', () => ({ resnapshotSupplierSession: (...a: any[]) => resnapshot(...a) }))
vi.mock('@admin/app/(admin)/admin/suppliers/[id]/edit/loading', () => ({ default: () => <div>edit-loading</div> }))

const autosave = { trigger: vi.fn(), flush: vi.fn(), resume: vi.fn(), status: 'idle' }
vi.mock('@/hooks/useAutosaveDraft', () => ({ useAutosaveDraft: () => autosave }))
const lockState: any = {}
const markLocked = vi.fn()
vi.mock('@/hooks/useDraftLock', async orig => ({ ...(await orig<any>()), useDraftLock: () => ({ ...lockState, markLocked }) }))
const editSession: any = { sessionId: 'sess1', save: vi.fn(), cancel: vi.fn() }
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => editSession }))

import EditSupplierClient from '@admin/app/(admin)/admin/suppliers/[id]/edit/EditSupplierClient'

const supplier = {
  name: 'Acme Supplies', gstin: '29ABCDE1234F1Z5', contact_name: 'Ravi', phone: '+919876543210', email: 'ravi@acme.test',
  address: '12 Industrial Area', payment_terms: 45, notes: 'Pays late', bank_name: 'HDFC', account_number: '0001', ifsc: 'HDFC0001234', upi_id: 'acme@upi',
}
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let draftFields: any = null

function route(url: string, init?: any) {
  if (url === '/api/admin/suppliers/s1') return json(true, { supplier })
  if (url.startsWith('/api/admin/suppliers/s1/draft?draft=d1') && !init?.method) return json(true, { draft_fields: draftFields })
  return json(true)
}

describe('EditSupplierClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftFields = null
    Object.assign(lockState, {
      lock: null, loaded: true, isMine: true, claimable: false, readOnly: false, closed: false, viewers: [], canTakeOver: false,
      canDiscard: true, busy: false, unsaved: null, setUnsaved: vi.fn(), release: vi.fn(), claim: vi.fn(), requestAccess: vi.fn(),
      handover: vi.fn(), takeover: vi.fn(), candidates: vi.fn(), refresh: vi.fn(),
    })
    editSession.sessionId = 'sess1'
    editSession.save.mockResolvedValue(true)
    editSession.cancel.mockResolvedValue(true)
    autosave.flush.mockResolvedValue(undefined)
    resnapshot.mockResolvedValue(undefined)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => route(url, init))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads the live supplier into the form, stripping the +91 prefix from the phone', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    expect(await screen.findByDisplayValue('Acme Supplies')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument()
    expect(screen.getByDisplayValue('45')).toBeInTheDocument()
    expect(screen.getByDisplayValue('HDFC0001234')).toBeInTheDocument()
    expect(screen.getByText('Edit Supplier')).toBeInTheDocument()
    expect(screen.queryByText('Draft pending')).not.toBeInTheDocument()
  })

  it('overlays draft fields on the live values and shows the draft state', async () => {
    draftFields = { name: 'Acme Draft', notes: 'From draft' }
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" draftTitle="Q3 update" />))
    expect(await screen.findByDisplayValue('Acme Draft')).toBeInTheDocument()
    expect(screen.getByDisplayValue('From draft')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ravi@acme.test')).toBeInTheDocument()
    expect(screen.getByText('Edit Draft · Q3 update')).toBeInTheDocument()
    expect(screen.getAllByText('Draft pending').length).toBeGreaterThan(0)
  })

  it('shows the not-found state when the supplier is missing', async () => {
    fetchMock.mockImplementation(async () => json(true, {}))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    expect(await screen.findByText('Supplier not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Suppliers' })).toBeInTheDocument()
  })

  it('shows a load failure when a request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('net'))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    expect(await screen.findByText('Failed to load supplier')).toBeInTheDocument()
  })

  it('forces GSTIN upper-case and limits the phone to digits', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    const gst = await screen.findByLabelText(/GSTIN/)
    fireEvent.change(gst, { target: { value: '29abcde1234f1z5' } })
    expect(gst).toHaveValue('29ABCDE1234F1Z5')
    const phone = screen.getByLabelText('Phone')
    fireEvent.change(phone, { target: { value: '98a76-54321x0' } })
    expect(phone).toHaveValue('9876543210')
  })

  it('looks up the bank from the IFSC on blur', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      url === 'https://ifsc.razorpay.com/ICIC0000001' ? json(true, { BANK: 'ICICI Bank' }) : route(url, init))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    const ifsc = await screen.findByLabelText('IFSC Code')
    fireEvent.change(ifsc, { target: { value: 'icic0000001' } })
    fireEvent.blur(ifsc)
    await waitFor(() => expect(screen.getByLabelText('Bank Name')).toHaveValue('ICICI Bank'))
  })

  it('autosaves through the draft hook when the form changes after hydrate', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Acme Two' } })
    await waitFor(() => expect(autosave.trigger).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Two', payment_terms: '45' })))
    expect(autosave.resume).toHaveBeenCalled()
  })

  it('Save as Draft flushes, resnapshots and returns to the list; disabled without a name', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    const name = await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers?tab=suppliers&active=true')))
    expect(autosave.flush).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Supplies' }))
    expect(resnapshot).toHaveBeenCalledWith('d1')
    fireEvent.change(name, { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: /Saving…|Save as Draft/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Update & Publish/ })).toBeDisabled()
  })

  it('toasts the error when saving the draft fails', async () => {
    autosave.flush.mockRejectedValue(new Error('Draft locked'))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: 'Save as Draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft locked', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('publishes the draft, closes the session and goes to the list', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: /Update & Publish/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers?tab=suppliers')))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(url).toBe('/api/admin/suppliers/s1/publish?draft=d1')
    expect(init.credentials).toBe('include')
    expect(editSession.save).toHaveBeenCalled()
  })

  it('toasts the API error and marks the lock when publish gets 423', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'POST' ? json(false, { error: 'Held by someone' }, 423) : route(url, init))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: /Update & Publish/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Held by someone', 'error'))
    expect(markLocked).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('opens the merge dialog on a draft conflict and finishes through it', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'POST' ? json(false, { code: 'DRAFT_CONFLICT', conflicts: [{ field: 'name' }, { field: 'gstin' }] }, 409) : route(url, init))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: /Update & Publish/ }))
    expect(await screen.findByText('merge:2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'merge-done' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers?tab=suppliers')))
    expect(editSession.save).toHaveBeenCalled()
  })

  it('discards a pending draft with DELETE and returns to the view page', async () => {
    draftFields = { name: 'Acme Draft' }
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByDisplayValue('Acme Draft')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers/s1/view')))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/suppliers/s1/draft?draft=d1', { method: 'DELETE', credentials: 'include' })
  })

  it('keeps the page and toasts when the discard request fails', async () => {
    draftFields = { name: 'Acme Draft' }
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'DELETE' ? json(false, { error: 'Cannot discard' }, 500) : route(url, init))
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByDisplayValue('Acme Draft')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cannot discard', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('cancel asks to confirm, rolls the session back and returns to the view', async () => {
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes?' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/admin/suppliers/s1/view')))
    expect(editSession.cancel).toHaveBeenCalled()
  })

  it('shows Cancel as a plain link to the list without an edit session', async () => {
    editSession.sessionId = null
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" />))
    await screen.findByLabelText(/^Name/)
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', expect.stringContaining('/admin/suppliers?tab=suppliers'))
  })

  it('renders the notice and a read-only form when another admin holds the draft', async () => {
    Object.assign(lockState, { isMine: false, readOnly: true, lock: { ownerId: 'a2', ownerName: 'Priya', lastActiveAt: new Date().toISOString() } })
    render(asAdmin(<EditSupplierClient id="s1" draftId="d1" notice={<p>Live changed since you started</p>} />))
    expect(await screen.findByText('Live changed since you started')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as Draft' })).not.toBeInTheDocument()
    expect(screen.getByText(/Read-only\./)).toBeInTheDocument()
  })
})
