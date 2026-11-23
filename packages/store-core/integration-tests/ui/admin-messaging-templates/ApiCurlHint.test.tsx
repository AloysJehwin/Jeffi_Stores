import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApiCurlHint from '@/components/admin/messaging-templates/ApiCurlHint'
import type { EditorTemplate } from '@/components/admin/messaging-templates/TemplateEditor'

// "Send via API": a <details> that builds a copy-ready curl for POST /v1/messages from the template.
// Single/Bulk tabs; the curl body reflects channel, slug and variable tokens. Copy uses navigator.clipboard.

const base = (over: Partial<EditorTemplate> = {}): EditorTemplate => ({
  slug: 'orders/shipped',
  channel: 'email',
  name: 'Shipped',
  body: 'Hi {{customer_name}}, your order shipped',
  ...over,
})

describe('ApiCurlHint (render + branches)', () => {
  beforeEach(() => {
    // navigator.clipboard is a read-only getter in happy-dom; redefine it.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined) },
    })
  })

  it('renders the summary, both tabs, and a single-message curl by default', () => {
    render(<ApiCurlHint value={base()} />)
    expect(screen.getByText('Send via API')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Single message' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Bulk' })).toHaveAttribute('aria-selected', 'false')
    // Single call hits /v1/messages with the template slug and a non-auto variable.
    expect(screen.getByText(/v1\/messages/)).toBeInTheDocument()
    expect(screen.getByText(/orders\/shipped/)).toBeInTheDocument()
    expect(screen.getByText(/customer_name/)).toBeInTheDocument()
  })

  it('switches to the bulk curl when the Bulk tab is clicked', () => {
    render(<ApiCurlHint value={base()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Bulk' }))
    expect(screen.getByRole('tab', { name: 'Bulk' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/v1\/messages\/bulk/)).toBeInTheDocument()
    expect(screen.getByText(/10 000 recipients/)).toBeInTheDocument()
    // Bulk-only helper note appears.
    expect(screen.getByText(/In bulk, top-level variables apply to everyone/)).toBeInTheDocument()
  })

  it('shows the Meta-approval caveat only for WhatsApp templates', () => {
    const { rerender } = render(<ApiCurlHint value={base({ channel: 'email' })} />)
    expect(screen.queryByText(/approved by Meta/)).not.toBeInTheDocument()
    rerender(<ApiCurlHint value={base({ channel: 'whatsapp', body: 'Order {{1}} update' })} />)
    expect(screen.getByText(/approved by Meta/)).toBeInTheDocument()
  })

  it('appends a caller note when provided', () => {
    render(<ApiCurlHint value={base()} note="Pass reference to dedupe." />)
    expect(screen.getByText(/Pass reference to dedupe\./)).toBeInTheDocument()
  })

  it('copies the current curl to the clipboard on the copy button', () => {
    render(<ApiCurlHint value={base()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy curl' }))
    const spy = (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatch(/curl -X POST/)
  })
})
