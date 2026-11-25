import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

const refresh = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const uploadKyc = vi.fn<(...a: any[]) => any>()
vi.mock('@controller/app/(ecom)/ecom/onboard/CompliancePanel', () => ({
  uploadKyc: (...a: any[]) => uploadKyc(...a),
  FileField: ({ id, label, fileName, onFile, onRemove }: any) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="file" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      {fileName && (
        <button type="button" onClick={onRemove}>
          Remove {fileName}
        </button>
      )}
    </div>
  ),
  ExpiryField: ({ value, onChange }: any) => <input aria-label="Expiry date" value={value} onChange={e => onChange(e.target.value)} />,
}))

import LicencesClient, { type LicenceDoc } from '@controller/app/(ecom)/ecom/dashboard/licences/LicencesClient'

const TODAY = '2026-11-24'
const doc = (over: Partial<LicenceDoc> = {}): LicenceDoc => ({
  id: 'd1', docType: 'fssai', category: 'food', number: '12345678901234', expiresOn: '2027-06-30', status: 'approved', note: null, reviewedAt: '2026-10-05T00:00:00Z', sentAt: '2026-10-01T00:00:00Z', ...over,
})
const view = (documents: LicenceDoc[] = [], selling: string[] = []) =>
  render(
    <ToastProvider>
      <LicencesClient tenantId="t1" today={TODAY} selling={selling} documents={documents} />
    </ToastProvider>,
  )
const chooseFile = (label: string) => fireEvent.change(screen.getByLabelText(label), { target: { files: [new File(['x'], 'licence.pdf', { type: 'application/pdf' })] } })

describe('LicencesClient', () => {
  it('shows the empty state with a link to add one', () => {
    view()
    expect(screen.getByText('No licences on file')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a licence' })).toHaveAttribute('href', '#add-licence')
  })

  it('lists an approved licence with its number, validity and review date', () => {
    view([doc()])
    expect(screen.getByText('FSSAI licence or registration')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText(/FSSAI number/)).toHaveTextContent('12345678901234')
    expect(screen.getByText(/Valid until 30 Jun 2027/)).toBeInTheDocument()
    expect(screen.getByText(/Sent 1 Oct 2026 · approved 5 Oct 2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', '/api/ecom/compliance/d1')
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
  })

  it('puts rejected first, shows the reason and asks for a new copy', () => {
    view([doc({ id: 'a', docType: 'iec', category: 'General', number: null, expiresOn: null }), doc({ id: 'b', status: 'rejected', note: 'Blurry scan' })])
    const items = screen.getAllByRole('listitem').filter(li => li.querySelector('a[href^="/api/ecom/compliance/"]'))
    expect(items[0]).toHaveTextContent('FSSAI licence or registration')
    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    expect(screen.getByText('Blurry scan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload a new copy' })).toBeInTheDocument()
  })

  it('flags an expiring licence with the days left and an expired one with a record warning', () => {
    view([doc({ id: 'a', expiresOn: '2026-12-04' }), doc({ id: 'b', docType: 'lmpc', category: 'food', number: null, expiresOn: '2026-11-01' })])
    expect(screen.getByText('Expires in 10 days')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText(/shows as expired on your store's record/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Upload the renewed one' })).toHaveLength(2)
  })

  it('renews a licence: needs a file, a valid number and expiry, then PUTs it and refreshes', async () => {
    uploadKyc.mockResolvedValue('kyc/key-1')
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    view([doc({ expiresOn: '2026-12-04' })])
    fireEvent.click(screen.getByRole('button', { name: 'Upload the renewed one' }))
    const send = screen.getByRole('button', { name: 'Send for review' })
    expect(send).toBeDisabled()
    chooseFile('Document')
    expect(await screen.findByRole('button', { name: /Remove licence.pdf/ })).toBeInTheDocument()
    expect(uploadKyc).toHaveBeenCalledWith(expect.any(File), 'fssai')
    expect(screen.getByText(/Enter the expiry date/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-12-01' } })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(await screen.findByText('FSSAI licence or registration sent for review. We email you if anything is wrong.')).toBeInTheDocument()
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/ecom/compliance')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toMatchObject({ tenantId: 't1', docType: 'fssai', category: 'food', number: '12345678901234', expiresOn: '2027-12-01', s3Key: 'kyc/key-1', fileName: 'licence.pdf' })
    expect(refresh).toHaveBeenCalled()
  })

  it('shows an upload failure instead of a file', async () => {
    uploadKyc.mockRejectedValue(new Error('File too large'))
    view([doc()])
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    chooseFile('Document')
    expect(await screen.findByText('File too large')).toBeInTheDocument()
  })

  it('toasts when the server refuses the document and keeps the form open', async () => {
    uploadKyc.mockResolvedValue('k')
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Number already used' }) }))
    view([doc()])
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    chooseFile('Document')
    await screen.findByRole('button', { name: /Remove/ })
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }))
    expect(await screen.findByText('Number already used')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeInTheDocument()
  })

  it('Cancel closes the renewal form', () => {
    view([doc()])
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Send for review' })).toBeNull()
  })

  it('"Selling something new?" lists the documents a category needs and marks what is on file', () => {
    const cat = 'Electronics & Gadgets'
    view([doc({ docType: 'bis_crs', category: cat, number: 'R-41000000', expiresOn: null })], [cat])
    expect(screen.getByText(/You applied to sell Electronics & Gadgets/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: cat }))
    const section = screen.getByText('Selling something new?').closest('section') ?? document.body
    expect(within(section as HTMLElement).getByText('Required')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('On file · Approved')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText(/Do you sell wireless devices/)).toBeInTheDocument()
    expect(within(section as HTMLElement).getAllByRole('button', { name: 'Upload' }).length).toBeGreaterThan(0)
  })

  it('uploads a document for a new category and sends it with that category', async () => {
    uploadKyc.mockResolvedValue('kyc/iec')
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', f)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Every store' }))
    const row = screen.getByText('Importer Exporter Code (IEC)').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Upload' }))
    chooseFile('Document')
    await screen.findByRole('button', { name: /Remove/ })
    fireEvent.change(screen.getByLabelText('IEC'), { target: { value: 'abcde12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }))
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ docType: 'iec', category: 'General', number: 'ABCDE12345' })
  })
})
