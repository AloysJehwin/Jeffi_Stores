'use client'

import { useState, useRef, useEffect } from 'react'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  delay?: number
  position?: 'top' | 'bottom' | 'left' | 'right'
  maxWidth?: string
}

export default function Tooltip({ content, children, delay = 120, position = 'top', maxWidth = '220px' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show() {
    timer.current = setTimeout(() => setVisible(true), delay)
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const posClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[position]

  const arrowClass = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-zinc-800 dark:border-t-zinc-700',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-zinc-800 dark:border-b-zinc-700',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-zinc-800 dark:border-l-zinc-700',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-zinc-800 dark:border-r-zinc-700',
  }[position]

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`absolute z-50 pointer-events-none ${posClass}`}
          style={{ maxWidth }}
        >
          <span className="block bg-zinc-800 dark:bg-zinc-700 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg whitespace-normal leading-snug">
            {content}
          </span>
          <span className={`absolute border-4 ${arrowClass}`} />
        </span>
      )}
    </span>
  )
}
