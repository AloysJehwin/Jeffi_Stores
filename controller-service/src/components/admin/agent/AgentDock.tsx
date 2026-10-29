'use client'

import { useEffect, useState } from 'react'
import { Bot, ChevronDown, History, Maximize2, Plus, Sparkles } from 'lucide-react'
import AgentChatPanel, { chatTitle } from './AgentChatPanel'
import { useAdminAgent } from '@/contexts/AdminAgentContext'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import type { PageContext } from '@/lib/admin-agent/conversations'

// The assistant docked at the bottom-right of every admin page (not /admin/agent, which is the full
// view of the same chat). A sheet on phones.

const GENERAL: { label: string; prompt: string }[] = [
  { label: 'Yesterday’s orders', prompt: 'Summarise yesterday orders by status and total revenue' },
  { label: 'Restock plan', prompt: 'Show me products with stock <= 5, ordered by how much we have sold them in the last 30 days' },
  { label: 'Stuck shipments', prompt: 'List orders that have been shipped but not delivered for more than 3 days' },
  { label: 'Top customers', prompt: 'Show me my top 5 customers by lifetime value' },
]

const FOR_ENTITY: Record<string, { label: string; prompt: string }[]> = {
  order: [
    { label: 'Summarise this order', prompt: 'Summarise this order' },
    { label: 'Where is it?', prompt: 'What is the shipping status of this order?' },
    { label: 'Draft a refund', prompt: 'Draft a refund for this order' },
  ],
  product: [
    { label: 'Stock and sales', prompt: 'Show stock and the last 30 days of sales for this product' },
    { label: 'Similar products', prompt: 'Find products similar to this one' },
  ],
  customer: [
    { label: 'Summarise this customer', prompt: 'Summarise this customer: orders, spend and anything open' },
    { label: 'Recent purchases', prompt: 'What has this customer bought recently?' },
  ],
}

const FOR_SECTION: Record<string, { label: string; prompt: string }[]> = {
  Orders: [{ label: 'Orders needing attention', prompt: 'Which orders need my attention today?' }],
  Products: [{ label: 'Slow movers', prompt: 'Which in-stock products have not sold in the last 60 days?' }],
  Customers: [{ label: 'New this week', prompt: 'Show me customers who signed up in the last 7 days, ordered by recency' }],
}

function suggestionsFor(pc: PageContext | null) {
  const kind = pc?.entity?.kind
  const specific = kind ? (FOR_ENTITY[kind] ?? [{ label: `Summarise this ${kind}`, prompt: `Summarise this ${kind}` }]) : (FOR_SECTION[pc?.section ?? ''] ?? [])
  return [...specific, ...GENERAL].slice(0, 5)
}

export default function AgentDock() {
  const { chat, enabled, showButton, open, onAgentPage, pageContext, openAgent, closeAgent, toggleAgent, expandToFull } = useAdminAgent()
  const [showHistory, setShowHistory] = useState(false)
  const buttonShown = enabled && showButton && !open && !onAgentPage

  // Toasts sit above the floating button while it shows.
  useEffect(() => {
    document.documentElement.style.setProperty('--dock-offset', buttonShown ? '64px' : '0px')
    return () => {
      document.documentElement.style.removeProperty('--dock-offset')
    }
  }, [buttonShown])

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && closeAgent()
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [open, closeAgent])

  if (!enabled || onAgentPage) return null

  const { info } = chat
  const title = chat.conversationId || chat.turns.length ? chatTitle(info.title) : 'New chat'
  const where = info.readOnly
    ? `Shared by ${info.ownerName || 'another admin'} · read-only`
    : pageContext?.entity
      ? `On ${pageContext.entity.kind} ${pageContext.entity.id.slice(0, 8)}`
      : `On ${pageContext?.section ?? 'admin'}`
  const btn = 'p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-secondary transition-colors'

  return (
    <>
      {buttonShown && (
        <button
          type="button"
          onClick={toggleAgent}
          className="fixed z-40 right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] w-12 h-12 rounded-full shadow-lg bg-gradient-to-br from-accent-500 to-secondary-500 text-white flex items-center justify-center hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2"
          title="Admin Assistant"
          aria-label="Open admin assistant"
        >
          <Bot className="w-5 h-5" />
          {chat.loading && <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Admin Assistant"
          className="fixed z-50 inset-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[420px] sm:h-[min(640px,calc(100vh-5rem))] flex flex-col bg-surface-elevated sm:rounded-2xl border border-border-default shadow-2xl overflow-hidden pt-[env(safe-area-inset-top)] sm:pt-0"
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-default shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-secondary-500 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
              <p className="text-[10px] text-foreground-muted truncate">{where}</p>
            </div>
            <button
              onClick={() => setShowHistory(s => !s)}
              className={showHistory ? 'p-1.5 rounded-lg bg-surface-secondary text-foreground' : btn}
              title="Your chats"
              aria-label="Your chats"
            >
              <History className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                chat.reset()
                setShowHistory(false)
              }}
              className={btn}
              title="New chat"
              aria-label="New chat"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={expandToFull} className={btn} title="Open in full view" aria-label="Open in full view">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button onClick={closeAgent} className={btn} title="Minimise" aria-label="Minimise">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <AgentChatPanel
            chat={chat}
            variant="dock"
            showHistory={showHistory}
            onConversationPicked={() => setShowHistory(false)}
            approveWrapper={node => <RequireWrite scope="agent:write">{node}</RequireWrite>}
            empty={
              <div className="py-6">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-accent-500" />
                  <p className="text-sm font-medium text-foreground">How can I help?</p>
                </div>
                <p className="text-xs text-foreground-muted mb-4">
                  I can look things up across the store and propose changes for your approval. I know which page
                  you are on.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestionsFor(pageContext).map(s => (
                    <button
                      key={s.label}
                      onClick={() => openAgent({ prompt: s.prompt })}
                      className="px-2.5 py-1.5 rounded-full border border-border-default text-xs text-foreground hover:border-accent-500 hover:bg-surface-secondary transition-colors"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        </div>
      )}
    </>
  )
}
