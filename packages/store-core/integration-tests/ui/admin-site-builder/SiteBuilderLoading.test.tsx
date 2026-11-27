import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockListSkeleton, BusyOverlay, EditorSkeleton, PanelSkeleton, PreviewSkeleton, WorkCard } from '@/components/admin/site-builder/SiteBuilderLoading'

// The Site Builder editor's loading states: each is announced as a busy status named after what is loading.

describe('SiteBuilderLoading', () => {
  it('WorkCard names the job and its step', () => {
    render(<WorkCard title="Applying Minimalist" step="Writing 26 pages…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Applying Minimalist')
    expect(screen.getByText('Writing 26 pages…')).toBeInTheDocument()
  })

  it('BusyOverlay shows the job while working and nothing otherwise', () => {
    const { container, rerender } = render(<BusyOverlay work={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<BusyOverlay work={{ title: 'Publishing', step: 'Publishing pages and theme…' }} />)
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Publishing')).toBeInTheDocument()
  })

  it('the skeletons are busy statuses labelled by what loads', () => {
    render(
      <>
        <PreviewSkeleton />
        <BlockListSkeleton rows={2} />
        <PanelSkeleton cards={2} label="Loading templates" />
      </>
    )
    expect(screen.getByRole('status', { name: 'Loading the preview…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: 'Loading blocks' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading templates' })).toBeInTheDocument()
  })

  it('EditorSkeleton carries its label to the preview it stands in for', () => {
    render(<EditorSkeleton label="Opening the visual editor…" />)
    expect(screen.getAllByRole('status', { name: 'Opening the visual editor…' }).length).toBeGreaterThanOrEqual(2)
  })
})
