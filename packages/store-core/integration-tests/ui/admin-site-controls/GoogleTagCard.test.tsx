import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// GoogleTagCard: three validated text fields that PATCH /api/admin/settings on blur. Validation runs
// client-side (lib/analytics/google-tag) before any network call, so a bad value never reaches fetch.

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
  useToastOptional: () => ({ showToast }),
}))

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import GoogleTagCard from '@/components/admin/site-controls/GoogleTagCard'

const initial = { google_tag_id: '', google_ads_conversion_id: '', google_ads_conversion_label: '' } as const

function okFetch() {
  return vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
}

describe('GoogleTagCard', () => {
  beforeEach(() => {
    showToast.mockReset()
    canWrite = true
  })

  it('renders the three labelled fields with their placeholders', () => {
    render(<GoogleTagCard initial={initial} isTenant />)
    expect(screen.getByText('Google tag ID')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('G-XXXXXXXXXX')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('AW-123456789')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('AbC-D_efG-h12_34-567')).toBeInTheDocument()
  })

  it('shows the tenant hint when isTenant is true', () => {
    render(<GoogleTagCard initial={initial} isTenant />)
    expect(screen.getByText(/Leave empty to load no Google tag/)).toBeInTheDocument()
  })

  it('shows the platform hint when isTenant is false', () => {
    render(<GoogleTagCard initial={initial} isTenant={false} />)
    expect(screen.getByText(/Leave empty to use the platform default tag/)).toBeInTheDocument()
  })

  it('rejects an invalid tag id on blur without calling fetch', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<GoogleTagCard initial={initial} isTenant />)
    const input = screen.getByPlaceholderText('G-XXXXXXXXXX')
    fireEvent.change(input, { target: { value: 'not-a-tag' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText(/Google tag ID must look like/)).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('PATCHes a valid tag id and toasts Saved', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<GoogleTagCard initial={initial} isTenant />)
    const input = screen.getByPlaceholderText('G-XXXXXXXXXX')
    fireEvent.change(input, { target: { value: 'G-ABCDE12345' } })
    fireEvent.blur(input)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ key: 'google_tag_id', value: 'G-ABCDE12345' })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved', 'success'))
  })

  it('clears the inline error as soon as the field is edited again', async () => {
    vi.stubGlobal('fetch', okFetch())
    render(<GoogleTagCard initial={initial} isTenant />)
    const input = screen.getByPlaceholderText('G-XXXXXXXXXX')
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText(/Google tag ID must look like/)).toBeInTheDocument())
    fireEvent.change(input, { target: { value: 'G-' } })
    expect(screen.queryByText(/Google tag ID must look like/)).not.toBeInTheDocument()
  })

  it('disables every field when the admin cannot write', () => {
    canWrite = false
    render(<GoogleTagCard initial={initial} isTenant />)
    expect(screen.getByPlaceholderText('G-XXXXXXXXXX')).toBeDisabled()
    expect(screen.getByPlaceholderText('AW-123456789')).toBeDisabled()
  })
})
