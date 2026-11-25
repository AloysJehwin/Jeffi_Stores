import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import MetaAppCard from '@/components/admin/MetaAppCard'

// MetaAppCard: collapsed summary; opening loads /integrations/meta-app, shows redirect URIs + credential form
// (write-gated), verifies+saves via POST and removes via a two-click DELETE.

const fetchMock = vi.fn<(...a: any[]) => any>()
const json = (ok: boolean, data: any) => ({ ok, json: async () => data })

const stateOwn = {
  own: true, appId: '12345', loginConfigId: 'L1', adsLoginConfigId: null,
  redirectUris: ['https://s.test/cb1', 'https://s.test/cb2'],
  deauthorizeUrl: 'https://s.test/deauth', dataDeletionUrl: 'https://s.test/delete',
}
const statePlatform = { ...stateOwn, own: false, appId: undefined, loginConfigId: null }

beforeEach(() => vi.stubGlobal('fetch', fetchMock))

describe('MetaAppCard', () => {
  it('shows the platform summary and does not fetch while collapsed', () => {
    render(<MetaAppCard canWrite />)
    expect(screen.getByText(/uses the platform's app/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use your own Meta app' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows Manage when the store already has its own app', () => {
    render(<MetaAppCard own canWrite />)
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument()
  })

  it('loads on open and lists redirect URIs and the app id', async () => {
    fetchMock.mockResolvedValue(json(true, stateOwn))
    render(<MetaAppCard own canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(await screen.findByText('https://s.test/cb1')).toBeInTheDocument()
    expect(screen.getByText('https://s.test/deauth')).toBeInTheDocument()
    expect(screen.getByText(/Facebook sign-in uses your app \(12345\)/)).toBeInTheDocument()
    expect(screen.getByText('Saved. Leave blank to keep it.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/integrations/meta-app')
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })

  it('shows a load error banner', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Boom' }))
    render(<MetaAppCard canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Use your own Meta app' }))
    expect(await screen.findByText('Boom')).toBeInTheDocument()
  })

  it('hides the form without write permission', async () => {
    fetchMock.mockResolvedValue(json(true, statePlatform))
    render(<MetaAppCard canWrite={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use your own Meta app' }))
    expect(await screen.findByText(/don't have permission to change the Meta app/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify and save' })).not.toBeInTheDocument()
  })

  it('keeps Verify disabled until id and secret are filled, then saves', async () => {
    const onChanged = vi.fn<(...a: any[]) => any>()
    fetchMock.mockResolvedValueOnce(json(true, statePlatform)).mockResolvedValueOnce(json(true, {}))
    const { container } = render(<MetaAppCard canWrite onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use your own Meta app' }))
    const save = await screen.findByRole('button', { name: 'Verify and save' })
    expect(save).toBeDisabled()
    const inputs = container.querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: ' 999 ' } })
    expect(save).toBeDisabled()
    fireEvent.change(inputs[1], { target: { value: 'sekret' } })
    expect(save).toBeEnabled()
    fetchMock.mockResolvedValueOnce(json(true, statePlatform))
    fireEvent.click(save)
    expect(await screen.findByText(/Meta accepted the app and it is saved/)).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ appId: '999', appSecret: 'sekret' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the API error when saving fails', async () => {
    fetchMock.mockResolvedValueOnce(json(true, statePlatform)).mockResolvedValueOnce(json(false, { error: 'Bad secret' }))
    const { container } = render(<MetaAppCard canWrite />)
    fireEvent.click(screen.getByRole('button', { name: 'Use your own Meta app' }))
    await screen.findByRole('button', { name: 'Verify and save' })
    const inputs = container.querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: '1' } })
    fireEvent.change(inputs[1], { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
    expect(await screen.findByText('Bad secret')).toBeInTheDocument()
  })

  it('removes the app only on the second click', async () => {
    const onChanged = vi.fn<(...a: any[]) => any>()
    fetchMock.mockResolvedValueOnce(json(true, stateOwn)).mockResolvedValueOnce(json(true, {}))
    render(<MetaAppCard own canWrite onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Click again to remove' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(screen.getByText(/Sign-in uses the platform app again/)).toBeInTheDocument()
  })
})
