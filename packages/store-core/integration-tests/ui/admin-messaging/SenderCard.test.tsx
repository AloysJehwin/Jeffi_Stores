import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="Provider" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import type { TenantSenderMeta } from '@/lib/messaging/tenant-senders'
import SenderCard, { day, CHANNEL_LABEL, AUDIENCE_LABEL } from '@/components/admin/messaging/SenderCard'

const badge = (s: unknown) => ({ tone: s ? ('green' as const) : ('muted' as const), label: s ? 'Live' : 'Not set' })
const existing = {
  provider: 'twilio',
  sender: '+919800000001',
  updatedAt: '2026-03-05T00:00:00Z',
  meta: { account_sid_last4: 'ab12', has_auth_token: true },
} as unknown as TenantSenderMeta

describe('SenderCard', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the empty state with an Assign action and a badge', () => {
    render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={null} badge={badge} empty="No SMS sender yet" />)
    expect(screen.getByRole('heading', { name: 'SMS' })).toBeInTheDocument()
    expect(screen.getByText('Not set')).toBeInTheDocument()
    expect(screen.getByText('No SMS sender yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Assign/ })).toBeInTheDocument()
  })

  it('shows the stored sender with masked credentials', () => {
    render(<SenderCard url="/api/n" channel="whatsapp" audience="admin" initial={existing} badge={badge} empty="" note={() => <p>custom note</p>} />)
    expect(screen.getByText('+919800000001')).toBeInTheDocument()
    expect(screen.getByText('ab12')).toBeInTheDocument()
    expect(screen.getByText('•••••••• (stored)')).toBeInTheDocument()
    expect(screen.getByText('custom note')).toBeInTheDocument()
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it('requires every credential before saving, then PUTs and refreshes', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sender: { ...existing, sender: 'JEFFI' } }) })
    const onChange = vi.fn()
    render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={null} badge={badge} empty="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Assign/ }))
    const save = screen.getByRole('button', { name: /Save number/ })
    expect(save).toBeDisabled()
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'JEFFI' } })
    fireEvent.change(inputs[1], { target: { value: 'ACxxx' } })
    const secret = document.querySelector('input[type=password]')!
    fireEvent.change(secret, { target: { value: 'tok' } })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Customer-facing SMS number saved', 'success'))
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'twilio', sender: 'JEFFI', config: { account_sid: 'ACxxx', auth_token: 'tok' } })
    expect(refresh).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
  })

  it('lets the flagship save Twilio with no credentials (platform account)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sender: existing }) })
    render(<SenderCard url="/api/n" channel="whatsapp" audience="customer" initial={null} badge={badge} empty="" platformAccount />)
    fireEvent.click(screen.getByRole('button', { name: /Assign/ }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '+919811111111' } })
    fireEvent.click(screen.getByRole('button', { name: /Save number/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).config).toEqual({})
  })

  it('removes the number and shows the empty state', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sender: null }) })
    render(<SenderCard url="/api/n" channel="sms" audience="ecom" initial={existing} badge={badge} empty="Nothing assigned" />)
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Ecom portal SMS number removed', 'success'))
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    expect(await screen.findByText('Nothing assigned')).toBeInTheDocument()
  })

  it('toasts the server error and keeps editing', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Bad SID' }) })
    render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={existing} badge={badge} empty="" platformAccount />)
    fireEvent.click(screen.getByRole('button', { name: /Replace/ }))
    expect(screen.getByText(/enter all of them again/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Replace number/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bad SID', 'error'))
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument()
  })

  it('exports labels and a date formatter', () => {
    expect(CHANNEL_LABEL.whatsapp).toBe('WhatsApp')
    expect(AUDIENCE_LABEL.admin).toBe('Admin-facing')
    expect(day('2026-03-05T00:00:00Z')).toContain('2026')
  })
})
