import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

import MergeOnLoad from '@/components/admin/drafts/MergeOnLoad'

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('MergeOnLoad', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('redirects to the done page when the publish succeeds', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    render(<MergeOnLoad publishPath="/api/pub" doneHref="/done" closeHref="/close" />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/done'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opens the merge dialog on a conflict', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'DRAFT_CONFLICT', conflicts: [{ path: 'title', label: 'Title', base: 'a', mine: 'b', theirs: 'c' }] }))
    render(<MergeOnLoad publishPath="/api/pub" doneHref="/done" closeHref="/close" />)
    expect(await screen.findByText('Live changed while you edited')).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
  })

  it('shows the error for a failed publish', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: 'Boom' }))
    render(<MergeOnLoad publishPath="/api/pub" doneHref="/done" closeHref="/close" />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
