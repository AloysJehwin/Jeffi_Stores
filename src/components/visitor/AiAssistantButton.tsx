'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import AiAssistantModal from './AiAssistantModal'

export default function AiAssistantButton() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        className="group relative p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-all active:scale-95 hover:bg-surface-secondary"
      >
        <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-purple-500/0 via-purple-500/0 to-blue-500/0 group-hover:from-purple-500/10 group-hover:to-blue-500/10 transition-all" aria-hidden />
        <svg
          className="w-5 h-5 relative text-purple-500 dark:text-purple-400 group-hover:scale-110 transition-transform"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
          <path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14z" />
          <path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5L5 4z" />
        </svg>
      </button>
      <AiAssistantModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
