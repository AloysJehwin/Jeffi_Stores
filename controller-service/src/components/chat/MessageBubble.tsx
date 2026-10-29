'use client'

import { Fragment, memo, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { renderTextWithLinks } from '@/components/ui/Linkify'
import { languageLabel, type SupportMessage } from '@/lib/support/types'
import AttachmentView from './AttachmentView'
import PayloadView from './PayloadView'
import Ticks from './Ticks'
import { fullTimeLabel, timeLabel } from './format'

// The assistant writes light markdown: **bold** is the only part worth rendering in a bubble.
function rich(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    /^\*\*[^*\n]+\*\*$/.test(part) ? <strong key={i}>{renderTextWithLinks(part.slice(2, -2))}</strong> : <Fragment key={i}>{renderTextWithLinks(part)}</Fragment>
  )
}

interface Props {
  m: SupportMessage
  mine: boolean
  /** Name shown above the text (agent or assistant); omitted for consecutive messages. */
  label?: string | null
  showTicks?: boolean
  onRetry?: (m: SupportMessage) => void
  onDecide?: (actionId: string, d: 'confirm' | 'decline') => Promise<void>
  onChip?: (text: string) => void
  orderHref?: (id: string) => string
}

function MessageBubble({ m, mine, label, showTicks, onRetry, onDecide, onChip, orderHref }: Props) {
  const [showOriginal, setShowOriginal] = useState(false)

  if (m.sender === 'system') {
    return (
      <div className="flex justify-center my-1">
        <span title={fullTimeLabel(m.at)} className="text-[11px] text-foreground-muted bg-surface-secondary border border-border-default rounded-full px-3 py-1 max-w-[85%] text-center">
          {m.text}
        </span>
      </div>
    )
  }

  const text = showOriginal && m.original ? m.original.text : m.text
  const onlyMedia = !text && m.attachments.length > 0 && !m.payloads.length
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[75%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`relative rounded-2xl px-3 pt-2 pb-1.5 text-sm shadow-sm min-w-[84px] ${
            mine ? 'bg-primary-500 text-white rounded-br-md' : 'bg-surface-elevated border border-border-default text-foreground rounded-bl-md'
          } ${onlyMedia ? 'p-1' : ''}`}
        >
          {label && <p className={`text-[11px] font-semibold mb-0.5 ${mine ? 'text-white/85' : 'text-primary-500'}`}>{label}</p>}
          {m.attachments.length > 0 && (
            <div className={text ? 'mb-1.5' : ''}>
              <AttachmentView items={m.attachments} mine={mine} />
            </div>
          )}
          {text && <p className="whitespace-pre-wrap break-words leading-relaxed">{rich(text)}</p>}
          <PayloadView payloads={m.payloads} onDecide={onDecide} onChip={onChip} orderHref={orderHref} />
          <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${mine ? 'text-white/75' : 'text-foreground-muted'} ${onlyMedia ? 'px-1.5' : ''}`}>
            {m.original && (
              <button type="button" onClick={() => setShowOriginal(v => !v)} className="underline-offset-2 hover:underline mr-auto pr-2 text-left">
                {showOriginal ? 'Show translation' : `Translated from ${languageLabel(m.original.lang)} · Show original`}
              </button>
            )}
            <time dateTime={m.at} title={fullTimeLabel(m.at)}>
              {timeLabel(m.at)}
            </time>
            {showTicks && <Ticks status={m.status} />}
          </div>
        </div>
        {m.status === 'failed' && mine && (
          <p className="text-[11px] text-red-500 mt-0.5 flex items-center gap-1">
            {m.error || 'Not sent'}
            {onRetry && (
              <button type="button" onClick={() => onRetry(m)} className="inline-flex items-center gap-0.5 font-semibold hover:underline">
                <RotateCw className="w-3 h-3" /> Retry
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(MessageBubble)
