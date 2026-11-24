import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Sk, PageLoading, LoadingKpis, LoadingTabs, LoadingToolbar, LoadingTable, LoadingSection, LoadingLines,
  LoadingFacts, LoadingChart, LoadingForm, LoadingCards, LoadingSplit,
} from '@/components/admin/kit/skeleton'

describe('PageLoading', () => {
  it('is a busy status labelled with the real title and shows back, description and action placeholders', () => {
    const { container } = render(<PageLoading title="Orders" description="All orders" back="Dashboard" actions={2}><p>kids</p></PageLoading>)
    const s = screen.getByRole('status', { name: 'Loading Orders' })
    expect(s).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByText('All orders')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('kids')).toBeInTheDocument()
    expect(container.querySelectorAll('.h-control')).toHaveLength(2)
  })

  it('shimmers the title when it is data and falls back to a generic label', () => {
    render(<PageLoading />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
  })
})

describe('real-label skeletons', () => {
  it('LoadingKpis shows each label', () => {
    render(<LoadingKpis labels={['Revenue', 'Orders']} />)
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
  })

  it('LoadingTabs shows tab names with the active one emphasised', () => {
    render(<LoadingTabs tabs={['Overview', 'Items']} active={1} />)
    expect(screen.getByText('Items')).toHaveClass('border-accent-500')
    expect(screen.getByText('Overview')).toHaveClass('border-transparent')
  })

  it('LoadingToolbar renders a search block and N filter blocks', () => {
    const { container } = render(<LoadingToolbar filters={3} />)
    expect(container.querySelectorAll('.sk')).toHaveLength(4)
  })

  it('LoadingTable shows column headings, rows, and an optional title and toolbar', () => {
    const { container, rerender } = render(<LoadingTable columns={['Name', 'Status', 'Total']} rows={3} />)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Status', 'Total'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(screen.queryByRole('heading')).toBeNull()
    rerender(<LoadingTable columns={['Name']} rows={1} title="Recent" toolbar={1} bare />)
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument()
  })

  it('LoadingSection and LoadingLines render a title and N lines', () => {
    const { container, rerender } = render(<LoadingSection title="Summary" lines={3} />)
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    expect(container.querySelectorAll('.sk')).toHaveLength(3)
    rerender(<LoadingSection title="Custom"><span>mine</span></LoadingSection>)
    expect(screen.getByText('mine')).toBeInTheDocument()
    rerender(<LoadingLines lines={5} />)
    expect(container.querySelectorAll('.sk')).toHaveLength(5)
  })

  it('LoadingFacts shows labels as terms', () => {
    render(<LoadingFacts labels={['Status', 'Placed']} />)
    expect(screen.getByText('Status').tagName).toBe('DT')
    expect(screen.getByText('Placed').tagName).toBe('DT')
  })

  it('LoadingChart shows its title and 12 bars', () => {
    const { container } = render(<LoadingChart title="Sales" />)
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument()
    expect(container.querySelectorAll('.sk')).toHaveLength(12)
  })

  it('LoadingForm shows section titles, field labels and the action bar unless disabled', () => {
    const sections = [{ title: 'Basics', description: 'Name it', fields: ['Title', 'Slug'] }]
    const { container, rerender } = render(<LoadingForm sections={sections} />)
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeInTheDocument()
    expect(screen.getByText('Name it')).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    const withFooter = container.querySelectorAll('.sk').length
    rerender(<LoadingForm sections={sections} footer={false} />)
    expect(container.querySelectorAll('.sk').length).toBe(withFooter - 3)
  })

  it('LoadingCards renders the requested count, LoadingSplit both columns, Sk is aria-hidden', () => {
    const { container, rerender } = render(<LoadingCards count={4} cols={2} />)
    expect(container.querySelectorAll('.grid > div')).toHaveLength(4)
    rerender(<LoadingSplit main={<p>main</p>} aside={<p>aside</p>} />)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('aside')).toBeInTheDocument()
    rerender(<Sk className="h-4 w-4" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
