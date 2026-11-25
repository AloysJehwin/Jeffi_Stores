import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { T1, mockApi, platformData, storeData, writes } from './fixtures'

// AI routing: ordered provider chips per capability with a model each and the store's price; saves one PUT per
// changed key ({ tenantId, key, value }); a store resets a row with DELETE ?key=&tenantId=.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))

import AiRouting from '@/components/admin/providers/AiRouting'

const pick = async (combo: string, option: string | RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name: combo }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('AiRouting', () => {
  it('shows each chip with its position, model and per-unit price', () => {
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    const text = within(screen.getByRole('list', { name: 'Text and chat order' }))
    const chips = text.getAllByRole('listitem')
    expect(chips.map(c => c.getAttribute('data-testid'))).toEqual(['chip-text-anthropic', 'chip-text-razer'])
    expect(chips[0]).toHaveTextContent('Position 1')
    expect(chips[0]).toHaveTextContent('₹0.504')
    expect(chips[0]).toHaveTextContent('per 1k input tokens')
    expect(within(chips[0]).getByRole('combobox', { name: 'Text and chat model for Claude' })).toHaveTextContent('Claude Sonnet 5.5')
    // Razer's text price is the price list's ollama row.
    expect(chips[1]).toHaveTextContent('₹0.06')
    expect(screen.getByTestId('chip-image-razer')).toHaveTextContent('per image')
    expect(screen.getByTestId('chip-video-google')).toHaveTextContent('₹15.00')
    expect(screen.getByTestId('chip-video-google')).toHaveTextContent('per second')
    expect(screen.getByTestId('chip-stt-azure')).toHaveTextContent('₹3.00')
    expect(screen.getByTestId('chip-stt-azure')).toHaveTextContent('per minute')
    expect(screen.getByTestId('chip-tts-sarvam')).toHaveTextContent('per 1k characters')
    // Unset orders show the gateway defaults: stt and tts start with Sarvam.
    expect(within(screen.getByRole('list', { name: 'Speech to text order' })).getAllByRole('listitem')[0]).toHaveTextContent('Sarvam')
  })

  it('reorders, changes a model and saves the changed keys', async () => {
    const calls = mockApi(() => platformData())
    const onSaved = vi.fn(async () => {})
    render(<AiRouting data={platformData()} canWrite onSaved={onSaved} />)
    const save = screen.getByRole('button', { name: 'Save AI routing' })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Move Razer up in Text and chat' }))
    await pick('Text and chat model for Claude', /Claude Haiku 5.5/)
    expect(screen.getByTestId('chip-text-anthropic')).toHaveTextContent('₹0.0252')
    expect(within(screen.getByRole('list', { name: 'Text and chat order' })).getAllByRole('listitem')[0]).toHaveTextContent('Razer')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(save)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(writes(calls).map(c => [c.method, c.url, c.body])).toEqual([
      ['PUT', '/api/admin/settings/providers', { tenantId: null, key: 'ai_text_providers', value: ['razer', 'anthropic'] }],
      ['PUT', '/api/admin/settings/providers', { tenantId: null, key: 'ai_models', value: { text: { anthropic: 'claude-haiku-5-5' } } }],
    ])
  })

  it('removes a provider and adds it back at the end', () => {
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Claude from Text and chat' }))
    expect(screen.queryByTestId('chip-text-anthropic')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Claude to Text and chat' }))
    const chips = within(screen.getByRole('list', { name: 'Text and chat order' })).getAllByRole('listitem')
    expect(chips.map(c => c.getAttribute('data-testid'))).toEqual(['chip-text-razer', 'chip-text-anthropic'])
  })

  it('blocks saving an empty order', () => {
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Google from Video' }))
    expect(screen.getByText('Add at least one provider.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save AI routing' })).toBeDisabled()
  })

  it('renders an unconfigured provider dashed and disabled, with the reason', () => {
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    const replicate = screen.getByTestId('chip-image-replicate')
    expect(replicate.firstElementChild).toHaveClass('border-dashed')
    expect(replicate).toHaveTextContent('Not configured: its key is missing from the gateway secret')
    expect(within(replicate).getByRole('combobox', { name: 'Images model for Replicate' })).toBeDisabled()
    expect(within(replicate).getByRole('button', { name: 'Remove Replicate from Images' })).toBeEnabled()
    const add = screen.getByRole('button', { name: 'Add Replicate to Video' })
    expect(add).toBeDisabled()
    expect(add).toHaveTextContent('not configured')
  })

  it('switches embeddings to one provider with the re-embed warning', async () => {
    const calls = mockApi(() => platformData())
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Embeddings provider' })
    expect(within(group).getByRole('radio', { name: 'Razer' })).toBeChecked()
    expect(screen.getByText(/re-embeds the catalog of every store that follows the platform/)).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: 'Azure' }))
    expect(screen.getByTestId('chip-embed-azure')).toHaveTextContent('₹0.0051')
    fireEvent.click(screen.getByRole('button', { name: 'Save AI routing' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body).toEqual({ tenantId: null, key: 'ai_embed_provider', value: 'azure' })
  })

  it('shows the save error inline', async () => {
    mockApi(() => platformData(), { 'PUT /api/admin/settings/providers': { status: 400, body: { error: 'Invalid value for ai_text_providers' } } })
    render(<AiRouting data={platformData()} canWrite onSaved={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Razer up in Text and chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save AI routing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid value for ai_text_providers')
  })

  it("resets a store's overridden row to the platform's", async () => {
    const calls = mockApi(() => storeData())
    const onSaved = vi.fn(async () => {})
    render(<AiRouting data={storeData()} canWrite onSaved={onSaved} />)
    expect(screen.getByText(/re-embeds this store's catalog/)).toBeInTheDocument()
    expect(within(screen.getByTestId('route-text')).queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('route-image')).getByRole('button', { name: "Reset Images to the platform's" }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(writes(calls)).toEqual([{ method: 'DELETE', url: `/api/admin/settings/providers?key=ai_image_providers&tenantId=${T1}`, body: undefined }])
  })

  it('resets an overridden model by restoring the inherited one', async () => {
    const data = storeData({
      settings: { ...storeData().settings, ai_models: { text: { anthropic: 'claude-opus-5-5' }, image: { google: 'gemini-3-pro-image' } } },
      inherited: { ...storeData().inherited, ai_models: { text: { anthropic: 'claude-sonnet-5-5' } } },
      overridden: ['ai_models'],
    })
    const calls = mockApi(() => data)
    render(<AiRouting data={data} canWrite onSaved={async () => {}} />)
    expect(screen.getByTestId('route-text')).toHaveTextContent('Store override')
    fireEvent.click(within(screen.getByTestId('route-text')).getByRole('button', { name: "Reset Text and chat to the platform's" }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body).toEqual({ tenantId: T1, key: 'ai_models', value: { text: { anthropic: 'claude-sonnet-5-5' }, image: { google: 'gemini-3-pro-image' } } })
  })

  it('is read-only without canEdit.ai or settings:write', () => {
    const { unmount } = render(<AiRouting data={storeData({ canEdit: { messaging: false, calling: false, ai: false, integrations: false } })} canWrite onSaved={async () => {}} />)
    expect(screen.queryByRole('button', { name: 'Save AI routing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reset / })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Text and chat model for Claude' })).toBeDisabled()
    unmount()
    render(<AiRouting data={platformData()} canWrite={false} onSaved={async () => {}} />)
    expect(screen.queryByRole('button', { name: 'Save AI routing' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Azure' })).toBeDisabled()
  })
})
