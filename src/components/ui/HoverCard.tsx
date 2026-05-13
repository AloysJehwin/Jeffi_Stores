'use client'

import { useState, useRef, useEffect } from 'react'

interface HoverCardProps {
  trigger: React.ReactNode
  children: React.ReactNode
  delay?: number
  align?: 'left' | 'center' | 'right'
  side?: 'top' | 'bottom'
  width?: string
}

export default function HoverCard({ trigger, children, delay = 150, align = 'left', side = 'bottom', width = '300px' }: HoverCardProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current)
    hideTimer.current = setTimeout(() => setVisible(false), 80)
  }
  function cancelHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  const alignClass = { left: 'left-0', center: 'left-1/2 -translate-x-1/2', right: 'right-0' }[align]
  const sideClass = side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {trigger}
      {visible && (
        <span
          className={`absolute z-50 ${sideClass} ${alignClass}`}
          style={{ width }}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          <span className="block bg-surface-elevated dark:bg-zinc-800 border border-border-default rounded-xl shadow-2xl overflow-hidden text-sm">
            {children}
          </span>
        </span>
      )}
    </span>
  )
}
