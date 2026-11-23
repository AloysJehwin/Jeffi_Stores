import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineLoading, PipelineToolbarLoading } from '@controller/components/admin/ecom/pipeline/PipelineLoading'

describe('PipelineLoading (render)', () => {
  it('renders the busy skeleton shell', () => {
    const { container } = render(<PipelineLoading />)
    const busy = container.querySelector('[aria-busy="true"]')
    expect(busy).toBeInTheDocument()
  })

  it('renders the toolbar skeleton with a Live label', () => {
    render(<PipelineToolbarLoading />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
