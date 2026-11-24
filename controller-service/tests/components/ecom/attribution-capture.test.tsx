import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import AttributionCapture from '@controller/app/(ecom)/ecom/AttributionCapture'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('AttributionCapture', () => {
  it('posts the click id and UTM tags of an ad landing, and nothing else from the URL', async () => {
    window.history.replaceState({}, '', '/pricing?gclid=g1&utm_source=google&utm_medium=cpc&utm_campaign=ecom_showcase&page=2')
    const { container } = render(<AttributionCapture />)
    expect(container.innerHTML).toBe('')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ecom/attribution')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      params: { gclid: 'g1', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ecom_showcase' },
      landingPath: '/pricing',
    })
  })

  it('does nothing on a visit without them', () => {
    window.history.replaceState({}, '', '/pricing?page=2')
    render(<AttributionCapture />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a failed request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    window.history.replaceState({}, '', '/?gclid=g1')
    render(<AttributionCapture />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })
})
