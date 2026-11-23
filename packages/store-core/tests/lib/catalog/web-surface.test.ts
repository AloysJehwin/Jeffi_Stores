import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))
vi.mock('@/lib/traffic/user-agent', () => ({
  parseUserAgent: vi.fn(),
}))

import { surfaceForUA, getWebSurface } from '@/lib/catalog/web-surface'
import { headers } from 'next/headers'
import { parseUserAgent } from '@/lib/traffic/user-agent'

describe('surfaceForUA', () => {
  beforeEach(() => {
    vi.mocked(parseUserAgent).mockReset()
    vi.mocked(parseUserAgent).mockReturnValue({ device: 'Desktop' } as any)
  })

  it('?layout=mobile|desktop override the UA', () => {
    expect(surfaceForUA('anything', 'mobile')).toBe('web_mobile')
    expect(surfaceForUA('anything', 'desktop')).toBe('web')
    expect(parseUserAgent).not.toHaveBeenCalled()
  })

  it('layout=app only maps to app when previewing', () => {
    expect(surfaceForUA(null, 'app', true)).toBe('app')
  })

  it('layout=app without preview falls through to the UA', () => {
    vi.mocked(parseUserAgent).mockReturnValue({ device: 'Desktop' } as any)
    expect(surfaceForUA('ua', 'app', false)).toBe('web')
  })

  it('a mobile UA maps to web_mobile, otherwise web', () => {
    vi.mocked(parseUserAgent).mockReturnValue({ device: 'Mobile' } as any)
    expect(surfaceForUA('phone-ua')).toBe('web_mobile')
    vi.mocked(parseUserAgent).mockReturnValue({ device: 'Desktop' } as any)
    expect(surfaceForUA('desktop-ua')).toBe('web')
  })
})

describe('getWebSurface', () => {
  it('reads the user-agent header and delegates to surfaceForUA', async () => {
    vi.mocked(parseUserAgent).mockReturnValue({ device: 'Mobile' } as any)
    vi.mocked(headers).mockResolvedValue({ get: (k: string) => (k === 'user-agent' ? 'phone' : null) } as any)
    expect(await getWebSurface()).toBe('web_mobile')
    expect(parseUserAgent).toHaveBeenCalledWith('phone')
  })

  it('an explicit layout still wins through the header path', async () => {
    vi.mocked(headers).mockResolvedValue({ get: () => 'desktop-ua' } as any)
    expect(await getWebSurface('mobile')).toBe('web_mobile')
  })
})
