import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import { AdminScopesProvider } from '@/contexts/AdminScopesContext'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'

const AI = ['social:write', 'catalog_enrichment:write']

function mount(scopes = AI, onPick = vi.fn()) {
  render(
    <AdminScopesProvider role="staff" scopes={scopes}>
      <AiMediaButton feature="social_image" sizes={[AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.portrait]} defaultPrompt="a red bolt" onPick={onPick} />
    </AdminScopesProvider>
  )
  return onPick
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/admin/ai/price')) return new Response(JSON.stringify({ priceInr: 2.5, unitType: 'image' }))
    return new Response(JSON.stringify({ images: [{ url: 'https://cdn/x.png', width: 1024, height: 1024 }], priceInr: 2, usageId: 'u1' }))
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AiMediaButton', () => {
  it('is hidden without the area write scope or the AI scope', () => {
    mount(['catalog_enrichment:write'])
    expect(screen.queryByRole('button', { name: /AI image/ })).toBeNull()
    cleanup()
    mount(['social:write'])
    expect(screen.queryByRole('button', { name: /AI image/ })).toBeNull()
  })

  it('shows the price first, generates, shows the charge and hands back the picked image', async () => {
    const onPick = mount()
    fireEvent.click(screen.getByRole('button', { name: /AI image/ }))
    expect(await screen.findByTestId('ai-price')).toHaveProperty('textContent', expect.stringContaining('₹2.50'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/ai/price?feature=social_image&quality=standard', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByTestId('ai-charge')).toHaveProperty('textContent', expect.stringContaining('₹2.00'))
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/admin/ai/image')!
    expect(JSON.parse(init.body)).toMatchObject({ feature: 'social_image', prompt: 'a red bolt', width: 1024, height: 1024, n: 1, quality: 'standard' })

    fireEvent.click(screen.getByText('Use this'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cdn/x.png' }))
  })

  it('offers a wallet top-up on a 402', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/admin/ai/price')
        ? new Response(JSON.stringify({ priceInr: 2.5 }))
        : new Response(JSON.stringify({ error: 'Insufficient', balanceInr: 1, neededInr: 2.5, topUpUrl: '/admin/wallet' }), { status: 402 })
    )
    mount()
    fireEvent.click(screen.getByRole('button', { name: /AI image/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(screen.getByText('Top up')).toBeTruthy())
    expect(screen.getByText('Top up').getAttribute('href')).toBe('/admin/wallet')
  })
})
