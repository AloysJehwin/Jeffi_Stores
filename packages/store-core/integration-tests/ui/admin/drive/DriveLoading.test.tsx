import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import DriveBrowserLoading, { DriveItemsLoading, DRIVE_SPLIT } from '@/components/admin/drive/DriveLoading'

describe('DriveItemsLoading', () => {
  it('is a busy status with folder tiles and a file grid by default', () => {
    const { container } = render(<DriveItemsLoading />)
    expect(screen.getByRole('status', { name: 'Loading files' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(container.querySelectorAll('.aspect-square')).toHaveLength(12)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a table with the real column headings in list view', () => {
    render(<DriveItemsLoading view="list" />)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Uploaded by', 'Size', 'Added'])
  })
})

describe('DriveBrowserLoading', () => {
  it('shows the real places, the privacy note and the My Drive title', () => {
    const { container } = render(<DriveBrowserLoading />)
    const nav = screen.getByRole('navigation', { name: 'Drive' })
    expect(nav).toHaveTextContent('My Drive')
    expect(nav).toHaveTextContent('Gallery')
    expect(nav).toHaveTextContent('Trash')
    expect(screen.getByText(/Files here are private to staff/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument()
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--admin-split-offset')).toBe(DRIVE_SPLIT['--admin-split-offset' as keyof typeof DRIVE_SPLIT])
  })
})
