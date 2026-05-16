'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface HoverCardProps {
  trigger: React.ReactNode
  children: React.ReactNode
  delay?: number
  align?: 'left' | 'center' | 'right'
  side?: 'top' | 'bottom'
  width?: string
  estimatedHeight?: number
}

export default function HoverCard({ trigger, children, delay = 150, align = 'left', side = 'bottom', width = '300px', estimatedHeight = 220 }: HoverCardProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function computePos() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const widthPx = parseInt(width) || 300
    let left = align === 'right'
      ? rect.right - widthPx
      : align === 'center'
      ? rect.left + rect.width / 2 - widthPx / 2
      : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - widthPx - 8))
    const cardHeight = cardRef.current?.offsetHeight || estimatedHeight
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openUp = side === 'top' || (side === 'bottom' && spaceBelow < cardHeight && spaceAbove > spaceBelow)
    const top = openUp ? rect.top - 6 : rect.bottom + 6
    setPos({ top, left, openUp })
  }

  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    computePos()
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

  useEffect(() => {
    if (visible) computePos()
  }, [visible])

  const card = visible && pos && typeof document !== 'undefined'
    ? createPortal(
        <span
          ref={cardRef}
          className="fixed z-[9999]"
          style={{
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width,
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
        >
          <span className="block bg-surface-elevated dark:bg-zinc-800 border border-border-default rounded-xl shadow-2xl overflow-hidden text-sm w-full">
            {children}
          </span>
        </span>,
        document.body
      )
    : null

  return (
    <span ref={triggerRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {trigger}
      {card}
    </span>
  )
}
