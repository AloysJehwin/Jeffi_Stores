import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ViewerFile } from '@/components/vault/ItemViewer'

// ItemViewer is the per-item file switcher. It picks a viewer by kind and shows a Download button
// only when the server said the file is downloadable. Child viewers (Media/Pdf/Image) sign a URL via
// stream-client, so we mock it; MediaViewer/PdfCanvasViewer are stubbed to isolate ItemViewer's logic.
const fetchStreamUrl = vi.fn().mockResolvedValue({ url: 'blob:x', disposition: 'attachment', kind: 'other', mimeType: 'application/zip' })
vi.mock('@/components/vault/stream-client', () => ({
  fetchStreamUrl: (...a: unknown[]) => fetchStreamUrl(...a),
}))
vi.mock('@/components/vault/MediaViewer', () => ({ default: ({ kind }: { kind: string }) => <div data-testid="media">{kind}</div> }))
vi.mock('@/components/vault/PdfCanvasViewer', () => ({ default: () => <div data-testid="pdf" /> }))

import ItemViewer from '@/components/vault/ItemViewer'

const file = (over: Partial<ViewerFile>): ViewerFile => ({
  id: 'f1',
  kind: 'video',
  displayName: 'Lesson 1',
  pageCount: null,
  downloadAllowed: false,
  ...over,
})

beforeEach(() => fetchStreamUrl.mockClear())

describe('ItemViewer (render + interaction)', () => {
  it('renders no file-switcher tablist for a single file', () => {
    render(<ItemViewer files={[file({ kind: 'video' })]} />)
    expect(screen.queryByRole('tablist', { name: 'Files' })).not.toBeInTheDocument()
    expect(screen.getByTestId('media')).toHaveTextContent('video')
  })

  it('shows a tab per file and switches the active viewer on click', () => {
    render(
      <ItemViewer
        files={[
          file({ id: 'a', kind: 'video', displayName: 'Clip' }),
          file({ id: 'b', kind: 'pdf', displayName: 'Guide' }),
        ]}
      />
    )
    expect(screen.getByRole('tablist', { name: 'Files' })).toBeInTheDocument()
    // First file active -> media viewer.
    expect(screen.getByTestId('media')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Guide/ }))
    expect(screen.getByTestId('pdf')).toBeInTheDocument()
  })

  it('tells the buyer download is unavailable when the file is not downloadable', () => {
    render(<ItemViewer files={[file({ downloadAllowed: false })]} />)
    expect(screen.getByText(/Streaming only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
  })

  it('renders a Download button that signs an attachment URL when allowed', async () => {
    render(<ItemViewer files={[file({ kind: 'other', downloadAllowed: true })]} />)
    const btn = screen.getByRole('button', { name: /Download/ })
    fireEvent.click(btn)
    await waitFor(() => expect(fetchStreamUrl).toHaveBeenCalledWith('f1', true))
  })

  it('renders the non-previewable message for an "other" file', () => {
    render(<ItemViewer files={[file({ kind: 'other', downloadAllowed: true })]} />)
    expect(screen.getByText(/opens outside the browser/)).toBeInTheDocument()
  })
})
