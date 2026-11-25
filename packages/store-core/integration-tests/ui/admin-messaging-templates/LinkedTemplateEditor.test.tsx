import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/components/admin/messaging-templates/TemplateEditor', () => ({
  toEditorTemplate: (a: any) => ({ id: a.id, name: a.name, body: a.current_version?.body ?? '' }),
  default: ({ value, onChange, onSave, saving, campaignKind }: any) => (
    <div data-testid="editor" data-kind={campaignKind ?? ''}>
      <span>{`editing ${value.name}`}</span>
      <button onClick={() => onChange({ ...value, name: 'Renamed' })}>edit</button>
      <button onClick={() => onSave()} disabled={saving}>save</button>
    </div>
  ),
}))

import LinkedTemplateEditor from '@/components/admin/messaging-templates/LinkedTemplateEditor'

const tpl = { id: 't1', name: 'Cart reminder', current_version: { body: 'Hi' } }
const campaigns = {
  campaigns: [
    { kind: 'a', name: 'Cart A', wa_template_slug: 'cart' },
    { kind: 'b', name: 'Cart B', wa_template_slug: 'cart' },
    { kind: 'me', name: 'This one', wa_template_slug: 'cart' },
    { kind: 'c', name: 'Other', wa_template_slug: 'other' },
  ],
}

describe('LinkedTemplateEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>(async (url: string, init?: any) => {
      if (init?.method === 'PUT') return { ok: true, json: async () => ({ ...tpl, name: 'Saved' }) }
      if (url.startsWith('/api/admin/campaigns')) return { ok: true, json: async () => campaigns }
      return { ok: true, json: async () => tpl }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads the template into the editor, mirrors it and lists other users', async () => {
    const onMirror = vi.fn()
    render(<LinkedTemplateEditor channel="whatsapp" slug="cart" currentKind="me" campaignKind="abandoned_cart" onMirror={onMirror} />)
    expect(await screen.findByText('editing Cart reminder')).toBeInTheDocument()
    expect(screen.getByTestId('editor').dataset.kind).toBe('abandoned_cart')
    expect(onMirror).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(await screen.findByText(/Also used by Cart A, Cart B — saving changes them too/)).toBeInTheDocument()
  })

  it('saves and publishes through PUT, then toasts', async () => {
    render(<LinkedTemplateEditor channel="whatsapp" slug="cart" />)
    await screen.findByText('editing Cart reminder')
    fireEvent.click(screen.getByText('edit'))
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template saved to the library.', 'success'))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(put[0]).toBe('/api/admin/messaging-templates/t1')
    expect(JSON.parse(put[1].body)).toMatchObject({ name: 'Renamed', publish: true })
    expect(await screen.findByText('editing Saved')).toBeInTheDocument()
  })

  it('toasts a failed save', async () => {
    render(<LinkedTemplateEditor channel="whatsapp" slug="cart" />)
    await screen.findByText('editing Cart reminder')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ message: 'Body too long' }) })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Template not saved: Body too long', 'error'))
  })

  it('shows a message when the template no longer exists', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    render(<LinkedTemplateEditor channel="email" slug="gone" />)
    expect(await screen.findByText(/no longer exists in the library/)).toBeInTheDocument()
  })

  it('is read-only without write permission', async () => {
    canWrite = false
    render(<LinkedTemplateEditor channel="whatsapp" slug="cart" />)
    expect(await screen.findByText(/read-only access to templates/)).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })
})
