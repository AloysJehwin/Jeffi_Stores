import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import { BackLink, PageHeader, PageBody, EntityPage, Card, Fields, Field, SplitRow } from '@/components/admin/kit/layout'

describe('PageHeader', () => {
  it('renders title, description, badges, meta, media and actions', () => {
    render(
      <PageHeader
        title="Orders"
        description="All paid orders"
        badges={<span>Live</span>}
        meta={<span>Updated now</span>}
        media={<img alt="logo" src="/l.png" />}
        actions={<button>New order</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByText('All paid orders')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Updated now')).toBeInTheDocument()
    expect(screen.getByAltText('logo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New order' })).toBeInTheDocument()
  })

  it('shows a back link only when given', () => {
    const { rerender } = render(<PageHeader title="T" back={{ href: '/admin/orders', label: 'Orders' }} />)
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders')
    rerender(<PageHeader title="T" />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('BackLink is a labelled link', () => {
    render(<BackLink href="/x" label="Back to X" />)
    expect(screen.getByRole('link', { name: 'Back to X' })).toHaveAttribute('href', '/x')
  })
})

describe('EntityPage', () => {
  it('renders every slot and the aside column', () => {
    render(
      <EntityPage
        header={<h1>Head</h1>}
        tabs={<div>tabs</div>}
        notices={<div>notice</div>}
        kpis={<div>kpis</div>}
        attention={[{ key: 'a', severity: 'warning', title: 'Low stock', sub: '3 SKUs', href: '/admin/inventory' } as any]}
        main={<div>main</div>}
        aside={<div>aside</div>}
      />
    )
    for (const t of ['Head', 'tabs', 'notice', 'kpis', 'main', 'aside', 'Low stock', '3 SKUs']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Low stock/ })).toHaveAttribute('href', '/admin/inventory')
  })

  it('skips attention when empty and renders main alone without aside', () => {
    const { container } = render(<EntityPage header={<h1>H</h1>} attention={[]} main={<div>only main</div>} />)
    expect(screen.queryByText('Needs attention')).toBeNull()
    expect(screen.getByText('only main')).toBeInTheDocument()
    expect(container.querySelector('.admin-sticky-pane')).toBeNull()
  })

  it('PageBody wraps children', () => {
    render(<PageBody><p>inside</p></PageBody>)
    expect(screen.getByText('inside')).toBeInTheDocument()
  })
})

describe('Card', () => {
  it('renders title, hint, action and children', () => {
    render(<Card title="Details" hint="Read only" action={<button>Edit</button>}>body</Card>)
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('omits the header with no title or action', () => {
    render(<Card>just body</Card>)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('just body')).toBeInTheDocument()
  })
})

describe('Fields / Field', () => {
  it('renders a term and its value, with a dash for empty values', () => {
    render(
      <Fields cols={3}>
        <Field label="Email" value="a@b.in" hint="primary" span={2} />
        <Field label="Phone" value="" />
        <Field label="Zero" value={0} />
      </Fields>
    )
    expect(screen.getByText('Email').tagName).toBe('DT')
    expect(screen.getByText('a@b.in')).toBeInTheDocument()
    expect(screen.getByText('primary')).toBeInTheDocument()
    expect(screen.getByText('Phone').nextElementSibling).toHaveTextContent('-')
    expect(screen.getByText('Zero').nextElementSibling).toHaveTextContent('0')
  })

  it('adds a copy button when copy text is given', () => {
    render(<Fields><Field label="SKU" value="SKU-1" copy="SKU-1" mono /></Fields>)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })
})

describe('SplitRow', () => {
  it('puts wide first by default and narrow first on request', () => {
    const { container, rerender } = render(<SplitRow wide={<div>W</div>} narrow={<div>N</div>} />)
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('W')
    rerender(<SplitRow wide={<div>W</div>} narrow={<div>N</div>} narrowFirst at="xl" scroll="wide" />)
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('N')
    expect(container.firstElementChild).toHaveClass('xl:grid-cols-3')
  })
})
