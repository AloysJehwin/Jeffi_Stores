import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const { installSessionGuard } = vi.hoisted(() => ({ installSessionGuard: vi.fn() }))
vi.mock('@/lib/client/session-guard', () => ({ installSessionGuard: () => installSessionGuard() }))

import SessionGuard from '@/components/security/SessionGuard'

describe('SessionGuard', () => {
  it('renders nothing', () => {
    const { container } = render(<SessionGuard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('installs the guard once, at module import', async () => {
    installSessionGuard.mockClear()
    vi.resetModules()
    await import('@/components/security/SessionGuard')
    expect(installSessionGuard).toHaveBeenCalledTimes(1)
  })
})
