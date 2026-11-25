import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import AdminAgentMessage, {
  AdminAgentUserMessage,
  internalMessageLabel,
  parseQuotationConfirm,
} from '@/components/admin/AdminAgentMessage'

const confirmMsg = (items: unknown) => `__quotation_confirm__${JSON.stringify(items)}`

describe('AdminAgentMessage markdown', () => {
  it('renders headings, paragraphs and horizontal rules', () => {
    const { container } = render(<AdminAgentMessage text={'# One\n## Two\n### Three\n#### Four\n\nHello\nworld\n\n---'} />)
    expect(screen.getByRole('heading', { level: 3, name: 'One' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Two' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: 'Three' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: 'Four' })).toBeInTheDocument()
    expect(screen.getByText(/Hello/)).toBeInTheDocument()
    expect(container.querySelector('hr')).not.toBeNull()
  })

  it('renders bullet and numbered lists', () => {
    render(<AdminAgentMessage text={'- apples\n- pears\n\n1. first\n2. second'} />)
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getByText('apples')).toBeInTheDocument()
    expect(screen.getByText('second').closest('ol')).not.toBeNull()
  })

  it('renders quotes and fenced code', () => {
    render(<AdminAgentMessage text={'> quoted\n> more\n\n```\nconst a = 1\n```'} />)
    expect(screen.getByText(/quoted/).closest('blockquote')).not.toBeNull()
    expect(screen.getByText('const a = 1').tagName).toBe('PRE')
  })

  it('renders a markdown table', () => {
    render(<AdminAgentMessage text={'| SKU | Qty |\n| --- | --- |\n| A-1 | 4 |\n| B-2 | 9 |'} />)
    expect(screen.getByRole('columnheader', { name: 'SKU' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'B-2' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('renders bold, italic and inline code', () => {
    render(<AdminAgentMessage text={'a **bold** and *ital* and `code` and _under_'} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('ital').tagName).toBe('EM')
    expect(screen.getByText('under').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders entity references as admin links and unknown ones as plain text', () => {
    render(<AdminAgentMessage text={'See [[order:o1|ORD-1]] and [[unknown:x|Thing]] and [[customer: c9 | Asha ]]'} />)
    expect(screen.getByRole('link', { name: 'ORD-1' })).toHaveAttribute('href', '/admin/orders/o1/view')
    expect(screen.getByRole('link', { name: 'Asha' })).toHaveAttribute('href', '/admin/customers/c9/view')
    expect(screen.getByText(/\[\[unknown:x\|Thing\]\]/)).toBeInTheDocument()
  })

  it('renders markdown links: internal, external and images', () => {
    const { container } = render(
      <AdminAgentMessage text={'[Orders](/admin/orders) [Docs](https://docs.test/a) [Rel](/shop) ![pic](https://cdn.test/p.png)'} />
    )
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/admin/orders')
    const ext = screen.getByRole('link', { name: 'Docs' })
    expect(ext).toHaveAttribute('target', '_blank')
    expect(ext).toHaveAttribute('rel', 'noreferrer noopener')
    expect(screen.getByRole('link', { name: 'Rel' })).toHaveAttribute('href', '/shop')
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/p.png')
  })

  it('shows a streaming cursor only when asked', () => {
    const { container, rerender } = render(<AdminAgentMessage text="hi" cursor />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    rerender(<AdminAgentMessage text="hi" />)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})

describe('quotation control messages', () => {
  it('parses a confirm message and rejects ordinary text', () => {
    expect(parseQuotationConfirm('hello')).toBeNull()
    expect(parseQuotationConfirm(confirmMsg([{ quantity: 2 }, null]))).toEqual([{ quantity: 2 }])
    expect(parseQuotationConfirm('__quotation_confirm__{bad')).toEqual([])
    expect(parseQuotationConfirm(confirmMsg({ not: 'array' }))).toEqual([])
  })

  it('labels a confirm message for list previews', () => {
    expect(internalMessageLabel('hello')).toBeNull()
    expect(internalMessageLabel(null)).toBeNull()
    expect(internalMessageLabel(confirmMsg([{}, { skipped: true }, {}]))).toBe('Confirmed 2 items for the quotation')
    expect(internalMessageLabel(confirmMsg([{}]))).toBe('Confirmed 1 item for the quotation')
  })
})

describe('AdminAgentUserMessage', () => {
  it('shows plain text', () => {
    render(<AdminAgentUserMessage text="Find order 55" />)
    expect(screen.getByText('Find order 55')).toBeInTheDocument()
  })

  it('shows attachment names instead of the raw notes', () => {
    render(<AdminAgentUserMessage text={'Check this [attachment_id=abc filename="rfq.pdf" mime=application/pdf]'} />)
    expect(screen.getByText('Check this')).toBeInTheDocument()
    expect(screen.getByText('rfq.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/attachment_id/)).toBeNull()
  })

  it('summarises a quotation confirmation with skipped items', () => {
    render(
      <AdminAgentUserMessage
        text={confirmMsg([
          { requestedText: 'Blue pens', quantity: 1200, buyUnit: 'box' },
          { requestedText: 'Odd thing', skipped: true },
          { quantity: 3 },
        ])}
      />
    )
    expect(screen.getByText(/Confirmed 2 items for the quotation/)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument()
    expect(screen.getByText('Blue pens')).toBeInTheDocument()
    expect(screen.getByText('→ 1,200 box')).toBeInTheDocument()
    expect(screen.getByText('Odd thing')).toHaveClass('line-through')
    expect(screen.getByText('skipped')).toBeInTheDocument()
    expect(screen.getByText('Item 3')).toBeInTheDocument()
    expect(screen.getByText('→ 3 pcs')).toBeInTheDocument()
  })
})
