import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import AutoRefresh from '@/components/admin/AutoRefresh'

describe('AutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the router on every interval while active', () => {
    render(<AutoRefresh active ms={1000} />)
    vi.advanceTimersByTime(3000)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('uses a 10s default interval', () => {
    render(<AutoRefresh active />)
    vi.advanceTimersByTime(9999)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing while inactive', () => {
    render(<AutoRefresh active={false} ms={1000} />)
    vi.advanceTimersByTime(5000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('stops refreshing after unmount', () => {
    const { unmount } = render(<AutoRefresh active ms={1000} />)
    unmount()
    vi.advanceTimersByTime(5000)
    expect(refresh).not.toHaveBeenCalled()
  })
})
