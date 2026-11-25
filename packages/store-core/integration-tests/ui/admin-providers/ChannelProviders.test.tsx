import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { T1, mockApi, platformData, storeData, writes } from './fixtures'

// Row 1: SMS, WhatsApp and Calling providers. Flagship edits all three (calling only at platform scope);
// a store sees messaging read-only. One Save writes the changed keys.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))

import ChannelProviders from '@/components/admin/providers/ChannelProviders'

describe('ChannelProviders', () => {
  it('saves the changed WhatsApp and calling providers', async () => {
    const calls = mockApi(() => platformData())
    const onSaved = vi.fn(async () => {})
    render(<ChannelProviders data={platformData()} flagship canWrite onSaved={onSaved} />)
    expect(screen.getByRole('button', { name: 'Save providers' })).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: 'WhatsApp provider' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Twilio' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Calling provider' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Twilio test line' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save providers' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(writes(calls).map(c => c.body)).toEqual([
      { tenantId: null, key: 'whatsapp_provider', value: 'twilio' },
      { tenantId: null, key: 'voice_provider', value: 'twilio_test' },
    ])
  })

  it('disables a messaging provider that is not ready', async () => {
    render(<ChannelProviders data={platformData()} flagship canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'SMS provider' }))
    expect(await screen.findByRole('option', { name: /AWS/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('lets the flagship reset a store override', async () => {
    const data = storeData({ canEdit: { messaging: true, calling: false, ai: true, integrations: false }, overridden: ['whatsapp_provider'] })
    const calls = mockApi(() => data)
    render(<ChannelProviders data={data} flagship canWrite onSaved={async () => {}} />)
    expect(screen.queryByRole('combobox', { name: 'Calling provider' })).not.toBeInTheDocument()
    expect(screen.getByText('Store override')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset WhatsApp to the platform default' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0]).toMatchObject({ method: 'DELETE', url: `/api/admin/settings/providers?key=whatsapp_provider&tenantId=${T1}` })
  })

  it('shows a store its messaging providers read-only', () => {
    render(<ChannelProviders data={storeData()} flagship={false} canWrite onSaved={async () => {}} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save providers' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Twilio')).toHaveLength(2)
    expect(screen.queryByText('Calling')).not.toBeInTheDocument()
  })
})
