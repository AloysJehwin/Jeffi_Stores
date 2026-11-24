import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let user: any = null
let aiEnabled = true
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { aiStorefrontEnabled: aiEnabled } }) }))
vi.mock('@/components/visitor/CustomerChatModal', () => ({
  default: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div role="dialog">
        chat modal<button onClick={onClose}>close chat</button>
      </div>
    ) : null,
}))

import AiAssistantButton from '@/components/visitor/AiAssistantButton'

describe('AiAssistantButton', () => {
  beforeEach(() => {
    user = { id: 'u1' }
    aiEnabled = true
  })

  it('renders nothing for a signed-out visitor', () => {
    user = null
    const { container } = render(<AiAssistantButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the AI storefront flag is off', () => {
    aiEnabled = false
    render(<AiAssistantButton />)
    expect(screen.queryByRole('button', { name: 'Open AI assistant' })).not.toBeInTheDocument()
  })

  it('opens and closes the chat modal', () => {
    render(<AiAssistantButton />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open AI assistant' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('chat modal')
    fireEvent.click(screen.getByRole('button', { name: 'close chat' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
