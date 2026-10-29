import { memo, useState, type ReactNode } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { RotateCw } from 'lucide-react-native'
import { Text, cn } from '../../ui'
import { languageLabel, type SupportMessage } from '../../types/support'
import AttachmentView from './AttachmentView'
import PayloadView from './PayloadView'
import Ticks from './Ticks'
import { timeLabel } from './format'

const URL_RE = /(https?:\/\/[^\s]+)/g

/** http(s) URLs as tappable links (trailing punctuation stays text). */
function linkify(text: string, linkClass: string, key: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return part
    const m = part.match(/^(.*?)([.,!?)]*)$/)
    const url = m ? m[1] : part
    return (
      <Text key={`${key}-${i}`}>
        <Text accessibilityRole="link" className={linkClass} onPress={() => Linking.openURL(url)}>
          {url}
        </Text>
        {m ? m[2] : ''}
      </Text>
    )
  })
}

// The assistant writes light markdown: **bold** is the only part worth rendering in a bubble.
function rich(text: string, linkClass: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    /^\*\*[^*\n]+\*\*$/.test(part) ? (
      <Text key={i} className="font-bold">
        {linkify(part.slice(2, -2), linkClass, `b${i}`)}
      </Text>
    ) : (
      <Text key={i}>{linkify(part, linkClass, `t${i}`)}</Text>
    )
  )
}

interface Props {
  m: SupportMessage
  mine: boolean
  /** Name above the text (agent or assistant); omitted for consecutive messages. */
  label?: string | null
  showTicks?: boolean
  /** The bubble's widest, in dp (sizes images). */
  maxWidth: number
  onRetry?: (m: SupportMessage) => void
  onDecide?: (actionId: string, d: 'confirm' | 'decline') => Promise<void>
  onChip?: (text: string) => void
  onOrder?: (id: string) => void
}

function MessageBubble({ m, mine, label, showTicks, maxWidth, onRetry, onDecide, onChip, onOrder }: Props) {
  const [showOriginal, setShowOriginal] = useState(false)

  if (m.sender === 'system') {
    return (
      <View className="my-1 items-center">
        <Text className="max-w-[85%] rounded-full border border-border-default bg-surface-secondary px-3 py-1 text-center text-[11px] text-foreground-muted">{m.text}</Text>
      </View>
    )
  }

  const text = showOriginal && m.original ? m.original.text : m.text
  const onlyMedia = !text && m.attachments.length > 0 && !m.payloads.length
  const failed = mine && m.status === 'failed'
  const meta = mine ? 'text-white/80' : 'text-foreground-muted'
  // Cards and links take the bubble's full width; text and chips size it to their content.
  const wide = m.payloads.some(p => p.type !== 'chips')
  return (
    <View className={cn('flex-row', mine ? 'justify-end' : 'justify-start')}>
      <View style={{ maxWidth }} className={cn('min-w-0', mine ? 'items-end' : 'items-start')}>
        <View
          style={wide ? { width: maxWidth } : undefined}
          className={cn(
            'min-w-[84px] rounded-2xl',
            onlyMedia ? 'p-1' : 'px-3 pb-1.5 pt-2',
            mine ? 'rounded-br-md bg-primary-500' : 'rounded-bl-md border border-border-default bg-surface-elevated'
          )}
        >
          {label ? <Text className={cn('mb-0.5 text-[11px] font-semibold', mine ? 'text-white/85' : 'text-primary-600 dark:text-primary-400')}>{label}</Text> : null}
          {m.attachments.length > 0 ? (
            <View className={text ? 'mb-1.5' : undefined}>
              <AttachmentView items={m.attachments} mine={mine} width={maxWidth - (onlyMedia ? 8 : 24) - (mine ? 0 : 2)} />
            </View>
          ) : null}
          {text ? (
            <Text className={cn('text-[15px] leading-[21px]', mine ? 'text-white' : 'text-foreground')}>
              {rich(text, mine ? 'text-white underline' : 'text-accent-600 underline dark:text-accent-400')}
            </Text>
          ) : null}
          <PayloadView payloads={m.payloads} onDecide={onDecide} onChip={onChip} onOrder={onOrder} />
          <View className={cn('mt-0.5 flex-row items-center justify-end gap-1', onlyMedia && 'px-1.5 pb-0.5')}>
            {m.original ? (
              <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setShowOriginal(v => !v)} className="mr-auto shrink pr-2">
                <Text className={cn('text-[10px] underline', meta)}>{showOriginal ? 'Show translation' : `Translated from ${languageLabel(m.original.lang)} · Show original`}</Text>
              </Pressable>
            ) : null}
            <Text className={cn('text-[10px]', meta)}>{timeLabel(m.at)}</Text>
            {showTicks ? <Ticks status={m.status} color={mine ? 'rgba(255,255,255,0.85)' : '#6b7280'} /> : null}
          </View>
        </View>
        {failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not sent. Tap to retry"
            disabled={!onRetry}
            hitSlop={8}
            onPress={() => onRetry?.(m)}
            className="mt-0.5 flex-row items-center gap-1"
          >
            <Text className="text-[11px] text-red-600 dark:text-red-400">{m.error || 'Not sent'}</Text>
            {onRetry ? (
              <>
                <RotateCw size={12} color="#dc2626" />
                <Text className="text-[11px] font-semibold text-red-600 dark:text-red-400">Retry</Text>
              </>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

export default memo(MessageBubble)
