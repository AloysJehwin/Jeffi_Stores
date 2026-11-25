import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

import PortalSignOutButton from '@/components/portal/PortalSignOutButton'

describe('PortalSignOutButton', () => {
  it('posts to the endpoint, shows progress, then goes home and refreshes', async () => {
    let resolve!: () => void
    const fetchMock = vi.fn(() => new Promise<Response>(r => (resolve = () => r(new Response('{}')))))
    vi.stubGlobal('fetch', fetchMock)
    render(<PortalSignOutButton endpoint="/api/portal/logout" homeHref="/portal" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/logout', { method: 'POST' })
    const busy = await screen.findByRole('button', { name: 'Signing out…' })
    expect(busy).toBeDisabled()
    resolve()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/portal'))
    expect(refresh).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still navigates on a server error, with a custom label and default home', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    render(<PortalSignOutButton endpoint="/x" label="Leave" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    vi.unstubAllGlobals()
  })
})
