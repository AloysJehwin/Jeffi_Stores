import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let search = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }))
vi.mock('@/components/admin/agent/AgentChatPanel', () => ({
  default: ({ chat, empty, approveWrapper, showHistory }: any) => (
    <div data-testid="panel" data-history={String(showHistory)}>
      {empty}
      {approveWrapper(<span>gated</span>)}
    </div>
  ),
  chatTitle: (t: string | null) => t || 'Untitled chat',
}))
vi.mock('@/contexts/AdminScopesContext', () => ({ RequireWrite: ({ scope, children }: any) => <div data-scope={scope}>{children}</div> }))
let agent: any
vi.mock('@/contexts/AdminAgentContext', () => ({ useAdminAgent: () => agent }))

import AgentDock from '@/components/admin/agent/AgentDock'

function mkAgent(o: any = {}) {
  return {
    chat: { loading: false, conversationId: null, turns: [], info: { title: null, readOnly: false, ownerName: null }, reset: vi.fn(), setInput: vi.fn() },
    enabled: true, showButton: true, open: false, onAgentPage: false, pageContext: { section: 'Orders', path: '/admin/orders' },
    openAgent: vi.fn(), closeAgent: vi.fn(), toggleAgent: vi.fn(), expandToFull: vi.fn(), ...o,
  }
}

beforeEach(() => {
  search = ''
  agent = mkAgent()
  document.documentElement.style.removeProperty('--dock-offset')
})

describe('AgentDock closed', () => {
  it('shows the floating button, which toggles the assistant, and offsets toasts', () => {
    render(<AgentDock />)
    expect(document.documentElement.style.getPropertyValue('--dock-offset')).toBe('64px')
    fireEvent.click(screen.getByRole('button', { name: 'Open admin assistant' }))
    expect(agent.toggleAgent).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing when disabled or on the agent page', () => {
    agent = mkAgent({ enabled: false })
    const { container, rerender } = render(<AgentDock />)
    expect(container).toBeEmptyDOMElement()
    agent = mkAgent({ onAgentPage: true })
    rerender(<AgentDock />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides the button when showButton is off', () => {
    agent = mkAgent({ showButton: false })
    render(<AgentDock />)
    expect(screen.queryByRole('button', { name: 'Open admin assistant' })).toBeNull()
  })

  it('shows a busy dot on the button while the chat loads', () => {
    agent = mkAgent()
    agent.chat.loading = true
    const { container } = render(<AgentDock />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })
})

describe('AgentDock open', () => {
  const open = (o: any = {}) => {
    agent = mkAgent({ open: true, ...o })
    return render(<AgentDock />)
  }

  it('shows the dialog with a New chat title, the section and general suggestions', () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Admin Assistant' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument()
    expect(screen.getByText('On Orders')).toBeInTheDocument()
    expect(screen.getByText('How can I help?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Orders needing attention' })).toBeInTheDocument()
    expect(document.documentElement.style.getPropertyValue('--dock-offset')).toBe('0px')
  })

  it('a suggestion sends its prompt, and a fill suggestion puts it in the box', () => {
    open({ pageContext: { section: 'Orders', path: '/admin/orders/123456789/view', entity: { kind: 'order', id: '123456789abc' } } })
    expect(screen.getByText('On order 12345678')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Summarise this order' }))
    expect(agent.openAgent).toHaveBeenCalledWith({ prompt: 'Summarise this order' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }))
    expect(agent.chat.setInput).toHaveBeenCalledWith('Mark this order as shipped with AWB ')
  })

  it('uses list suggestions and shows the filter count when the page is filtered', () => {
    search = 'status=paid&city=Pune&page=2&tab=x'
    open()
    expect(screen.getByText('On Orders · 2 filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What am I looking at?' })).toBeInTheDocument()
  })

  it('falls back to a generic suggestion for an unknown entity kind', () => {
    open({ pageContext: { section: 'Misc', path: '/admin/x', entity: { kind: 'widget', id: 'w1' } } })
    expect(screen.getByRole('button', { name: 'Summarise this widget' })).toBeInTheDocument()
  })

  it('header buttons: history toggles, new chat resets, expand and minimise', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Your chats' }))
    expect(screen.getByTestId('panel')).toHaveAttribute('data-history', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(agent.chat.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('panel')).toHaveAttribute('data-history', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Open in full view' }))
    expect(agent.expandToFull).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Minimise' }))
    expect(agent.closeAgent).toHaveBeenCalledTimes(1)
  })

  it('Escape minimises unless a modal dialog is open', () => {
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(agent.closeAgent).toHaveBeenCalledTimes(1)
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(agent.closeAgent).toHaveBeenCalledTimes(1)
    modal.remove()
  })

  it('titles an open chat and marks a shared one read-only', () => {
    open({ chat: { ...mkAgent().chat, conversationId: 'c1', info: { title: 'Stock check', readOnly: true, ownerName: 'Priya' } } })
    expect(screen.getByRole('heading', { name: 'Stock check' })).toBeInTheDocument()
    expect(screen.getByText('Shared by Priya · read-only')).toBeInTheDocument()
  })

  it('gates approvals on agent:write', () => {
    open()
    expect(screen.getByText('gated').parentElement).toHaveAttribute('data-scope', 'agent:write')
  })
})
