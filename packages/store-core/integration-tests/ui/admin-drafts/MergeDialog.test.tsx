import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MergeDialog, { publishWithResolutions } from '@/components/admin/drafts/MergeDialog'

const conflicts = [
  { path: 'title', label: 'Title', base: 'Old', mine: 'Mine title', theirs: 'Their title', theirsBy: 'Asha', theirsAt: null },
  { path: 'active', label: 'Active', base: true, mine: false, theirs: true, theirsBy: null, theirsAt: null },
] as never

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('publishWithResolutions', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('posts the picks with extra body and reports ok', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    const r = await publishWithResolutions('/api/p', { title: 'mine' }, { note: 'x' })
    expect(r).toEqual({ ok: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ note: 'x', resolutions: { title: 'mine' } })
  })

  it('returns the conflicts of a 409 DRAFT_CONFLICT', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'DRAFT_CONFLICT', conflicts: [{ path: 'a' }], error: 'clash' }))
    expect(await publishWithResolutions('/api/p')).toEqual({ ok: false, conflicts: [{ path: 'a' }], error: 'clash' })
  })

  it('falls back to a generic error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad') } })
    expect(await publishWithResolutions('/api/p')).toEqual({ ok: false, error: 'Publish failed' })
  })
})

describe('MergeDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists each overlapping field with both sides and disables Publish until all are picked', () => {
    render(<MergeDialog open conflicts={conflicts} publishPath="/api/p" onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Live changed while you edited')).toBeInTheDocument()
    expect(screen.getByText(/2 fields you changed were also changed/)).toBeInTheDocument()
    expect(screen.getByText('Their title')).toBeInTheDocument()
    expect(screen.getByText('Mine title')).toBeInTheDocument()
    expect(screen.getByText('Was: Old')).toBeInTheDocument()
    expect(screen.getByText('Was: Yes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('publishes with the bulk "keep all mine" choice and calls onDone', async () => {
    fetchMock.mockResolvedValue(reply(200, {}))
    const onDone = vi.fn()
    render(<MergeDialog open conflicts={conflicts} publishPath="/api/p" onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep all mine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).resolutions).toEqual({ title: 'mine', active: 'mine' })
  })

  it('shows a refreshed conflict list and the error when publish hits new overlaps', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'DRAFT_CONFLICT', conflicts: [{ path: 'title', label: 'Title', base: 'x', mine: 'm', theirs: 'newer' }], error: 'Changed again' }))
    const onDone = vi.fn()
    render(<MergeDialog open conflicts={conflicts} publishPath="/api/p" onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take all theirs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Changed again')).toBeInTheDocument()
    expect(screen.getByText('newer')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onClose from Cancel', () => {
    const onClose = vi.fn()
    render(<MergeDialog open conflicts={conflicts} publishPath="/api/p" onClose={onClose} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
