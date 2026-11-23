import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// HomepageLock: context + hook for the homepage draft lock. useHomepageLock derives readOnly, builds
// the per-write draft headers, and on a 423 toasts + drops to read-only. HomepageLockBanner renders
// the shared DraftLockBanner only when a draft is open. useDraftLock, toast and the banner are mocked;
// the real header helpers (draft-lock-client / homepage-sections) run unmocked.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

const markLocked = vi.fn<(...a: any[]) => any>()
const lockObj = { readOnly: false, markLocked }
const useDraftLockMock = vi.fn<(...a: any[]) => any>(() => lockObj)
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: (...a: any[]) => useDraftLockMock(...a) }))
vi.mock('@/components/admin/kit', () => ({
  DraftLockBanner: ({ scope }: any) => <div data-testid="banner">banner:{scope}</div>,
}))

import { HomepageLockProvider, HomepageLockBanner, useHomepageLock } from '@/components/admin/homepage/HomepageLock'

// Probe exposes the hook's derived state via DOM, and captures the live hook so async actions
// (locked) can be awaited directly in the test.
let captured: ReturnType<typeof useHomepageLock> | null = null
function Probe() {
  const h = useHomepageLock()
  captured = h
  return (
    <div>
      <span data-testid="readonly">{String(h.readOnly)}</span>
      <span data-testid="headers">{JSON.stringify(h.headers())}</span>
    </div>
  )
}

describe('useHomepageLock (via provider)', () => {
  beforeEach(() => {
    lockObj.readOnly = false
    useDraftLockMock.mockReturnValue(lockObj)
  })

  it('with no context (no provider) it builds empty headers and is not read-only', () => {
    render(<Probe />)
    // No provider: ctx is null, so readOnly stays false and headers are empty (no lockId).
    expect(screen.getByTestId('readonly')).toHaveTextContent('false')
    expect(screen.getByTestId('headers')).toHaveTextContent('{}')
  })

  it('with an open draft it is writable and stamps the draft header', () => {
    render(
      <HomepageLockProvider draftId="d1">
        <Probe />
      </HomepageLockProvider>
    )
    expect(screen.getByTestId('readonly')).toHaveTextContent('false')
    expect(screen.getByTestId('headers')).toHaveTextContent('{"x-homepage-draft":"d1"}')
  })

  it('is read-only inside the provider when no draft id is set', () => {
    render(
      <HomepageLockProvider draftId={null}>
        <Probe />
      </HomepageLockProvider>
    )
    expect(screen.getByTestId('readonly')).toHaveTextContent('true')
  })

  it('reflects the underlying lock readOnly flag', () => {
    lockObj.readOnly = true
    render(
      <HomepageLockProvider draftId="d1">
        <Probe />
      </HomepageLockProvider>
    )
    expect(screen.getByTestId('readonly')).toHaveTextContent('true')
  })

  it('locked(): a 423 toasts and marks the lock, a 200 does nothing', async () => {
    render(
      <HomepageLockProvider draftId="d1">
        <Probe />
      </HomepageLockProvider>
    )
    let ok200: boolean | undefined
    await act(async () => {
      ok200 = await captured!.locked({ status: 200, json: async () => ({}) } as any)
    })
    expect(ok200).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
    expect(markLocked).not.toHaveBeenCalled()

    let locked423: boolean | undefined
    await act(async () => {
      locked423 = await captured!.locked({ status: 423, json: async () => ({ error: 'held' }) } as any)
    })
    expect(locked423).toBe(true)
    expect(showToast).toHaveBeenCalledWith('held', 'error')
    expect(markLocked).toHaveBeenCalled()
  })
})

describe('HomepageLockBanner', () => {
  it('renders the settings:write banner when a draft is open', () => {
    render(
      <HomepageLockProvider draftId="d1">
        <HomepageLockBanner />
      </HomepageLockProvider>
    )
    expect(screen.getByTestId('banner')).toHaveTextContent('banner:settings:write')
  })

  it('renders nothing with no draft open', () => {
    const { container } = render(
      <HomepageLockProvider draftId={null}>
        <HomepageLockBanner />
      </HomepageLockProvider>
    )
    expect(container.querySelector('[data-testid="banner"]')).toBeNull()
  })

  it('renders nothing with no provider at all', () => {
    const { container } = render(<HomepageLockBanner />)
    expect(container.firstChild).toBeNull()
  })
})
