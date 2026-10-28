'use client'

import { useEffect, useState } from 'react'
import { Bot, X, MessageSquare, Slash, LayoutGrid, Maximize2, Minimize2, Plus, History } from 'lucide-react'
import AgentChatPanel from './agent/AgentChatPanel'
import { useAdminAgentChat } from '@/hooks/useAdminAgentChat'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'chat' | 'slash' | 'tools'

const SLASH_COMMANDS: { command: string; example: string; description: string }[] = [
  {
    command: '/find-customer',
    example: '/find-customer aloys@gmail.com',
    description: 'Get full customer profile + LTV',
  },
  { command: '/products-top', example: '/products-top', description: 'Top selling products in the last 30 days' },
  {
    command: '/restock-suggestions',
    example: '/restock-suggestions',
    description: 'Low-stock items that need ordering',
  },
  {
    command: '/stuck-shipments',
    example: '/stuck-shipments',
    description: 'Orders shipped >3 days ago, not delivered',
  },
  { command: '/campaign-stats', example: '/campaign-stats', description: 'Campaign performance for the last 30 days' },
]

const TOOL_PALETTE: { label: string; description: string; prompt: string }[] = [
  {
    label: 'Top customers by spend',
    description: 'Highest lifetime value',
    prompt: 'Show me my top 5 customers by lifetime value',
  },
  {
    label: 'Stuck shipments',
    description: 'Orders not delivered after 3 days',
    prompt: 'List orders that have been shipped but not delivered for more than 3 days',
  },
  {
    label: 'Restock plan',
    description: 'Low stock items + their recent demand',
    prompt: 'Show me products with stock <= 5, ordered by how much we have sold them in the last 30 days',
  },
  {
    label: 'Yesterday orders',
    description: 'Quick recap',
    prompt: 'Summarise yesterday orders by status and total revenue',
  },
  {
    label: 'Abandoned cart performance',
    description: 'How is the campaign doing?',
    prompt: 'Get the abandoned_cart campaign stats for the last 30 days',
  },
  {
    label: 'New customers this week',
    description: 'Last 7 days',
    prompt: 'Show me customers who signed up in the last 7 days, ordered by recency',
  },
]

export default function AdminAgentModal({ isOpen, onClose }: Props) {
  const chat = useAdminAgentChat()
  const [tab, setTab] = useState<Tab>('chat')
  const [maximized, setMaximized] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  function newChat() {
    chat.reset()
    setShowHistory(false)
  }

  useEffect(() => {
    if (isOpen) chat.loadConversations()
    else {
      chat.reset()
      setShowHistory(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        style={{
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all ${
          maximized
            ? 'top-3 w-[calc(100vw-1.5rem)] h-[calc(100vh-1.5rem)]'
            : 'top-3 sm:top-5 w-[min(1100px,calc(100vw-1.5rem))] max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2.5rem)]'
        }`}
      >
        <div
          className={`bg-surface-elevated rounded-2xl border border-border-default shadow-2xl overflow-hidden flex flex-col h-full ${maximized ? '' : 'max-h-[inherit]'}`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Admin Assistant</h2>
                <p className="text-[10px] text-foreground-muted">Read-only chat + admin-approved actions</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={newChat}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                title="New chat"
                aria-label="New chat"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowHistory(s => !s)}
                className={`p-1.5 rounded-lg transition-colors ${showHistory ? 'bg-surface-secondary text-foreground' : 'text-foreground-muted hover:text-foreground hover:bg-surface-secondary'}`}
                title="Chat history"
                aria-label="Chat history"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={() => setMaximized(m => !m)}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                title={maximized ? 'Restore' : 'Maximize'}
                aria-label={maximized ? 'Restore' : 'Maximize'}
              >
                {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-2 border-b border-border-default">
            {(
              [
                { id: 'chat', label: 'Chat', icon: MessageSquare },
                { id: 'slash', label: 'Slash', icon: Slash },
                { id: 'tools', label: 'Tools', icon: LayoutGrid },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors border-b-2 ${
                  tab === id
                    ? 'text-accent-600 dark:text-accent-400 border-accent-500'
                    : 'text-foreground-muted hover:text-foreground border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'chat' && (
            <AgentChatPanel
              chat={chat}
              variant="modal"
              showHistory={showHistory}
              onConversationPicked={() => setShowHistory(false)}
              empty={
                <div className="text-center py-8">
                  <p className="text-sm text-foreground-muted">
                    Ask me anything about the store. I can search products, look up orders, summarise customers,
                    propose actions for your approval.
                  </p>
                </div>
              }
            />
          )}

          {tab === 'slash' && (
            <div className="p-4 space-y-2 overflow-y-auto flex-1 min-h-0">
              <p className="text-xs text-foreground-muted mb-2">Quick commands. Click to send.</p>
              {SLASH_COMMANDS.map(cmd => (
                <button
                  key={cmd.command}
                  onClick={() => {
                    setTab('chat')
                    chat.sendMessage(cmd.example)
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
                >
                  <p className="text-sm font-mono text-accent-600 dark:text-accent-400">{cmd.example}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">{cmd.description}</p>
                </button>
              ))}
            </div>
          )}

          {tab === 'tools' && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto flex-1 min-h-0">
              {TOOL_PALETTE.map(t => (
                <button
                  key={t.label}
                  onClick={() => {
                    setTab('chat')
                    chat.sendMessage(t.prompt)
                  }}
                  className="text-left px-3 py-3 rounded-lg border border-border-default hover:border-accent-500 hover:bg-surface-secondary transition-colors"
                >
                  <p className="text-sm font-semibold text-foreground">{t.label}</p>
                  <p className="text-xs text-foreground-muted mt-0.5">{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
