import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { mockApi, platformData, voice, writes } from './fixtures'

// Integrations (flagship, platform scope): voice_config fields merge over the stored config and PUT as one key;
// Test buttons POST /api/admin/settings/providers/credentials/test, which reads the platform's secrets.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))

import Integrations from '@/components/admin/providers/Integrations'

const box = (title: string) => screen.getByText(title).closest('div.flex.flex-col') as HTMLElement

describe('Integrations', () => {
  it('shows readiness and secret status, never a credential field', () => {
    const { container } = render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    expect(within(box('Exotel calling')).getByText('Incomplete')).toBeInTheDocument()
    expect(within(box('Exotel calling')).getByText('EXOTEL_API_TOKEN missing')).toBeInTheDocument()
    expect(within(box('Twilio test line')).getByText('Ready')).toBeInTheDocument()
    expect(within(box('Call voice')).getByText('Claude via workload identity')).toBeInTheDocument()
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0)
    expect(screen.queryByLabelText(/API key|API token|Auth token|Speech key/i)).not.toBeInTheDocument()
  })

  it('runs the Exotel test against the secrets and shows the result', async () => {
    const calls = mockApi(() => ({}), { 'POST /api/admin/settings/providers/credentials/test': { body: { ok: true, message: 'Exotel answered: balance ₹1,240' } } })
    render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(within(box('Exotel calling')).getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Exotel answered: balance ₹1,240')).toBeInTheDocument()
    expect(writes(calls)).toEqual([{ method: 'POST', url: '/api/admin/settings/providers/credentials/test', body: { provider: 'exotel' } }])
  })

  it('reports a failed speech engine test', async () => {
    const calls = mockApi(() => ({}), { 'POST /api/admin/settings/providers/credentials/test': { status: 400, body: { error: 'SARVAM_API_KEY is not set' } } })
    render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test Sarvam' }))
    expect(await screen.findByText('SARVAM_API_KEY is not set')).toBeInTheDocument()
    expect(writes(calls)[0].body).toEqual({ provider: 'sarvam' })
  })

  it('saves Exotel settings merged over the stored voice config', async () => {
    const calls = mockApi(() => ({}))
    const onSaved = vi.fn(async () => {})
    render(<Integrations data={platformData()} canWrite onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('AgentStream app ID'), { target: { value: '67890' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Exotel' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const v = voice()
    expect(writes(calls)[0].body).toEqual({
      tenantId: null,
      key: 'voice_config',
      value: {
        exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+911401234567', appId: '67890' },
        twilioTest: { from: '+14155550100' },
        testNumbers: ['+919876543210'],
        sarvam: { sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', voices: v.sarvam.voices },
        speech: { sttProvider: 'sarvam', ttsProvider: 'sarvam' },
        azureSpeech: { region: 'centralindia', voices: v.azureSpeech.voices },
        llmModel: 'claude-haiku-5-5',
      },
    })
  })

  it('validates and saves test line numbers', async () => {
    const calls = mockApi(() => ({}))
    render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    const add = screen.getByLabelText('Add to Test numbers')
    fireEvent.change(add, { target: { value: '98765' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    expect(screen.getByText('Use E.164: + then country code and number.')).toBeInTheDocument()
    fireEvent.change(add, { target: { value: '+91 99999 00000' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save test line' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body.value.testNumbers).toEqual(['+919876543210', '+919999900000'])
  })

  it('switches the speech-to-text engine order and the call model', async () => {
    const calls = mockApi(() => ({}))
    render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Speech-to-text engine order' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Azure AI Speech, then Sarvam' }))
    fireEvent.change(screen.getByLabelText('Claude model for calls'), { target: { value: 'claude-sonnet-5-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call voice' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body.value).toMatchObject({ speech: { sttProvider: 'azure', ttsProvider: 'sarvam' }, llmModel: 'claude-sonnet-5-5' })
  })

  it('saves and clears the DLT ids', async () => {
    const calls = mockApi(() => ({}))
    render(<Integrations data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.change(screen.getByLabelText('DLT entity ID'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove JEFFIS' }))
    const add = screen.getByLabelText('Add to Sender IDs')
    fireEvent.change(add, { target: { value: 'jeffit' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save DLT' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(2))
    expect(writes(calls).map(c => [c.method, c.url, c.body])).toEqual([
      ['PUT', '/api/admin/settings/providers', { tenantId: null, key: 'sms_dlt_sender_ids', value: ['JEFFIT'] }],
      ['DELETE', '/api/admin/settings/providers?key=sms_dlt_entity_id', undefined],
    ])
  })

  it('is read-only without integrations rights', () => {
    render(<Integrations data={platformData({ canEdit: { messaging: true, calling: true, ai: true, integrations: false } })} canWrite onSaved={async () => {}} />)
    expect(screen.getByLabelText('Account SID')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Exotel' })).not.toBeInTheDocument()
  })
})
