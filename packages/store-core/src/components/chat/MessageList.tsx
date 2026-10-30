'use client'

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import type { SupportMessage } from '@/lib/support/types'
import MessageBubble from './MessageBubble'
import { dayLabel, sameDay } from './format'

interface Props {
  messages: SupportMessage[]
  isMine: (m: SupportMessage) => boolean
  /** Sender label above a bubble (null to omit). */
  labelFor?: (m: SupportMessage) => string | null
  showTicks?: (m: SupportMessage) => boolean
  onRetry?: (m: SupportMessage) => void
  onDecide?: (actionId: string, d: 'confirm' | 'decline') => Promise<void>
  onChip?: (text: string) => void
  orderHref?: (id: string) => string
  /** Shown under the last message (typing dots). */
  footer?: ReactNode
  /** Shown when there are no messages yet. */
  empty?: ReactNode
  className?: string
}

const NEAR_BOTTOM = 96

/**
 * The scrolling conversation: day separators, bubbles, and a "new messages" pill. Only the list
 * scrolls (never the page), and it follows new messages only when you are already at the bottom.
 */
export default function MessageList({ messages, isMine, labelFor, showTicks, onRetry, onDecide, onChip, orderHref, footer, empty, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const seen = useRef(0)
  const first = useRef(true)
  const [unseen, setUnseen] = useState(0)

  const toBottom = useCallback((smooth: boolean) => {
    const el = box.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottom.current = true
    setUnseen(0)
  }, [])

  useLayoutEffect(() => {
    const n = messages.length
    if (first.current) {
      if (n) {
        first.current = false
        toBottom(false)
      }
      seen.current = n
      return
    }
    const added = messages.slice(seen.current)
    seen.current = n
    if (!added.length) {
      if (atBottom.current) toBottom(false)
      return
    }
    if (atBottom.current || added.some(isMine)) toBottom(true)
    else setUnseen(u => u + added.length)
  }, [messages, isMine, toBottom])

  // Typing dots appearing shouldn't leave the last line hidden.
  useEffect(() => {
    if (footer && atBottom.current) toBottom(true)
  }, [footer, toBottom])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    atBottom.current = near
    if (near && unseen) setUnseen(0)
  }

  return (
    <div className={`relative min-h-0 flex-1 ${className}`}>
      <div ref={box} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3 space-y-1.5">
        {messages.length === 0 && empty}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || !sameDay(prev.at, m.at)
          const label = labelFor?.(m) ?? null
          const sameRun = prev && !newDay && prev.sender === m.sender && prev.senderName === m.senderName && prev.sender !== 'system'
          return (
            <Fragment key={m.clientId ? `c:${m.clientId}` : m.id}>
              {newDay && (
                <div className="flex justify-center py-2 sticky top-0 z-[1] pointer-events-none">
                  <span className="text-[11px] font-medium text-foreground-secondary bg-surface-secondary/95 backdrop-blur border border-border-default rounded-full px-3 py-0.5 shadow-sm">
                    {dayLabel(m.at)}
                  </span>
                </div>
              )}
              <div className={sameRun ? '' : 'pt-1.5'}>
                <MessageBubble
                  m={m}
                  mine={isMine(m)}
                  label={sameRun ? null : label}
                  showTicks={showTicks?.(m)}
                  onRetry={onRetry}
                  onDecide={onDecide}
                  onChip={onChip}
                  orderHref={orderHref}
                />
              </div>
            </Fragment>
          )
        })}
        {footer}
      </div>
      {unseen > 0 && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary-500 text-white text-xs font-semibold px-3 py-1.5 shadow-lg"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {unseen} new message{unseen === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}
