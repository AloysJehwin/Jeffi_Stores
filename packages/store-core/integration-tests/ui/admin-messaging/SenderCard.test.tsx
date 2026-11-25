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

  describe('India SMS (DLT) via AWS', () => {
    const inDlt = {
      provider: 'aws',
      sender: 'JEFFIS',
      updatedAt: '2026-03-05T00:00:00Z',
      meta: { credentials: 'platform', region: 'ap-south-1' },
    } as unknown as TenantSenderMeta

    it('offers the type for SMS only, defaults to the platform header, takes no keys and shows the cost hint', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sender: inDlt }) })
      const { unmount } = render(<SenderCard url="/api/n" channel="whatsapp" audience="customer" initial={null} badge={badge} empty="" dltHeaders={['JEFFIS']} />)
      fireEvent.click(screen.getByRole('button', { name: /Assign/ }))
      expect(screen.queryByRole('option', { name: 'India SMS (DLT) via AWS' })).toBeNull()
      unmount()

      render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={null} badge={badge} empty="" dltHeaders={['JEFFIS', 'JEFFSV']} />)
      fireEvent.click(screen.getByRole('button', { name: /Assign/ }))
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'in_dlt' } })
      expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('JEFFIS')
      expect(document.querySelector('input[type=password]')).toBeNull()
      expect(screen.getByDisplayValue('ap-south-1')).toBeDisabled()
      expect(screen.getByText(/About ₹0.44 per SMS/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Save number/ }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'aws', sender: 'JEFFIS', config: { credentials: 'platform' } })
    })

    it('validates an own header and entity id before saving', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sender: inDlt }) })
      render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={null} badge={badge} empty="" dltHeaders={['JEFFIS']} />)
      fireEvent.click(screen.getByRole('button', { name: /Assign/ }))
      fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'in_dlt' } })
      fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '__own__' } })
      const save = screen.getByRole('button', { name: /Save number/ })
      expect(save).toBeDisabled()
      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0], { target: { value: 'MYSHOP' } })
      fireEvent.change(inputs[1], { target: { value: '123' } })
      expect(save).toBeDisabled()
      fireEvent.change(inputs[1], { target: { value: '1001000000000000001' } })
      await waitFor(() => expect(save).toBeEnabled())
      fireEvent.click(save)
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: 'aws', sender: 'MYSHOP', config: { credentials: 'platform', dlt_entity_id: '1001000000000000001' } })
    })

    it('shows a saved sender and checks it on AWS, read-only', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ header: 'JEFFIS', registered: false }) })
      render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={inDlt} badge={badge} empty="" checkUrl="/api/check" />)
      expect(screen.getByText('India SMS (DLT) via AWS')).toBeInTheDocument()
      expect(screen.getByText(/Platform AWS account/)).toBeInTheDocument()
      expect(screen.getByText('Jeffi Stores (shared)')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Check sender ID/ }))
      expect(await screen.findByText('Not registered on AWS')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/check?header=JEFFIS')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('hides Assign, Replace and Remove when read-only', () => {
      render(<SenderCard url="/api/n" channel="sms" audience="customer" initial={inDlt} badge={badge} empty="" readOnly />)
      expect(screen.queryByRole('button', { name: /Replace|Assign|Remove/ })).toBeNull()
      expect(screen.getByText('JEFFIS')).toBeInTheDocument()
    })
  })

  it('exports labels and a date formatter', () => {
    expect(CHANNEL_LABEL.whatsapp).toBe('WhatsApp')
    expect(AUDIENCE_LABEL.admin).toBe('Admin-facing')
    expect(day('2026-03-05T00:00:00Z')).toContain('2026')
  })
})
