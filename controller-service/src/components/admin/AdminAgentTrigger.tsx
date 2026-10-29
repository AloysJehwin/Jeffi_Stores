'use client'

import { Bot } from 'lucide-react'
import { useAdminAgent } from '@/contexts/AdminAgentContext'

export default function AdminAgentTrigger() {
  const { enabled, open, onAgentPage, toggleAgent } = useAdminAgent()
  if (!enabled || onAgentPage) return null

  return (
    <button
      type="button"
      onClick={toggleAgent}
      aria-pressed={open}
      className={`h-9 w-9 inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 ${open ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
      title="Admin Assistant"
      aria-label="Toggle admin assistant"
    >
      <Bot className="w-5 h-5" />
    </button>
  )
}
