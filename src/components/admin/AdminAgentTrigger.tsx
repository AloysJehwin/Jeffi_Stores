'use client'

import { useState } from 'react'
import { Bot } from 'lucide-react'
import AdminAgentModal from './AdminAgentModal'

export default function AdminAgentTrigger({ canUse }: { canUse: boolean }) {
  const [open, setOpen] = useState(false)
  if (!canUse) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500"
        title="Admin Assistant"
        aria-label="Open admin assistant"
      >
        <Bot className="w-5 h-5" />
      </button>
      <AdminAgentModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
