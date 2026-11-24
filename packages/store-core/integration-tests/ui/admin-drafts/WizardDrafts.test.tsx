import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const confirmFn = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import WizardDrafts from '@/components/admin/drafts/WizardDrafts'

const rows = [
  { id: 'w1', title: 'Import A', updated_at: new Date().toISOString(), admin_name: 'Asha', lock: null },
  { id: 'w2', title: 'Import B', updated_at: new Date().toISOString(), admin_name: null, lock: { ownerName: 'Ravi', mine: false } },
]
const ok = (data: unknown) => ({ ok: true, json: async () => data })

function setup(props: Partial<React.ComponentProps<typeof WizardDrafts>> = {}) {
  return render(
    <WizardDrafts endpoint="/api/drafts/imports" heading="Unfinished imports" icon={<i>ico</i>} writeScope="products:write" label={d => String(d.title)} discardMessage="Nothing is imported." resumeHref={id => `/imports/${id}`} {...props} />
  )
}

describe('WizardDrafts', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders nothing when there are no drafts', async () => {
    fetchMock.mockResolvedValue(ok({ drafts: [] }))
    const { container } = setup()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('lists drafts with owner info and resume links', async () => {
    fetchMock.mockResolvedValue(ok({ drafts: rows }))
    setup({ detail: () => 'reviewing SQL' })
    expect(await screen.findByText('Unfinished imports')).toBeInTheDocument()
    expect(screen.getByText('Import A')).toBeInTheDocument()
    expect(screen.getByText(/reviewing SQL · started by Asha/)).toBeInTheDocument()
    expect(screen.getByText(/being edited by Ravi/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Resume' })[0]).toHaveAttribute('href', '/imports/w1')
  })

  it('uses the onResume callback when the wizard opens in place', async () => {
    fetchMock.mockResolvedValue(ok({ drafts: rows }))
    const onResume = vi.fn()
    setup({ resumeHref: undefined, onResume })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Resume' }))[1])
    expect(onResume).toHaveBeenCalledWith('w2')
  })

  it('discards after confirmation and reloads', async () => {
    confirmFn.mockResolvedValue(true)
    fetchMock.mockResolvedValueOnce(ok({ drafts: rows }))
    fetchMock.mockResolvedValueOnce(ok({}))
    fetchMock.mockResolvedValueOnce(ok({ drafts: [] }))
    setup()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Discard' }))[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft discarded', 'success'))
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard draft', message: 'Discard "Import A"? Nothing is imported.' }))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/drafts/imports/w1')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    await waitFor(() => expect(screen.queryByText('Unfinished imports')).not.toBeInTheDocument())
  })

  it('does not delete when the confirm is declined, and toasts a failed delete', async () => {
    fetchMock.mockResolvedValue(ok({ drafts: rows }))
    confirmFn.mockResolvedValueOnce(false)
    setup()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Discard' }))[0])
    await waitFor(() => expect(confirmFn).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    confirmFn.mockResolvedValueOnce(true)
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Locked' }) })
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked', 'error'))
  })

  it('hides Discard without write permission', async () => {
    canWrite = false
    fetchMock.mockResolvedValue(ok({ drafts: rows }))
    setup()
    await screen.findByText('Import A')
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  })
})
