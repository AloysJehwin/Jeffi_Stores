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
        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
        title="Admin Assistant"
        aria-label="Open admin assistant"
      >
        <Bot className="w-4 h-4" />
      </button>
      <AdminAgentModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
