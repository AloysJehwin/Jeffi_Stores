import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { FlatList, Platform, Pressable, View, useWindowDimensions, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { ArrowDown } from 'lucide-react-native'
import { Text } from '../../ui'
import type { SupportMessage } from '../../types/support'
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
  onOrder?: (id: string) => void
  /** Under the last message (typing dots, "chat ended"). */
  footer?: ReactElement | null
}

const NEAR_BOTTOM = 96
const keyOf = (m: SupportMessage) => (m.clientId ? `c:${m.clientId}` : m.id)

/**
 * The conversation, newest at the bottom (an inverted list, so it opens there): day separators,
 * bubbles, and a "new messages" pill. It follows new messages only when you're already at the bottom.
 */
export default function MessageList({ messages, isMine, labelFor, showTicks, onRetry, onDecide, onChip, onOrder, footer }: Props) {
  const list = useRef<FlatList<SupportMessage>>(null)
  const { width } = useWindowDimensions()
  const maxWidth = Math.min(Math.round((width - 24) * 0.85), 520)
  const data = useMemo(() => messages.slice().reverse(), [messages])
  const atBottom = useRef(true)
  const seen = useRef<{ n: number; last: string | null }>({ n: 0, last: null })
  const [unseen, setUnseen] = useState(0)

  const toBottom = useCallback((animated: boolean) => {
    list.current?.scrollToOffset({ offset: 0, animated })
    atBottom.current = true
    setUnseen(0)
  }, [])

  useEffect(() => {
    const prev = seen.current
    const last = messages.length ? keyOf(messages[messages.length - 1]) : null
    seen.current = { n: messages.length, last }
    if (!prev.n || last === prev.last) return
    const i = messages.findIndex(m => keyOf(m) === prev.last)
    const added = i >= 0 ? messages.slice(i + 1) : messages.slice(prev.n)
    if (!added.length) return
    if (atBottom.current || added.some(isMine)) toBottom(true)
    else setUnseen(u => u + added.length)
  }, [messages, isMine, toBottom])

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const near = e.nativeEvent.contentOffset.y < NEAR_BOTTOM
    atBottom.current = near
    if (near && unseen) setUnseen(0)
  }

  const renderItem = useCallback<ListRenderItem<SupportMessage>>(
    ({ item: m, index }) => {
      const prev = messages[messages.length - 2 - index]
      const newDay = !prev || !sameDay(prev.at, m.at)
      const sameRun = !!prev && !newDay && prev.sender === m.sender && prev.senderName === m.senderName && prev.sender !== 'system'
      return (
        <View>
          {newDay ? (
            <View className="items-center py-2">
              <Text className="rounded-full border border-border-default bg-surface-secondary px-3 py-0.5 text-[11px] font-medium text-foreground-secondary">{dayLabel(m.at)}</Text>
            </View>
          ) : null}
          <View className={sameRun ? 'pt-1' : 'pt-2'}>
            <MessageBubble
              m={m}
              mine={isMine(m)}
              label={sameRun ? null : labelFor?.(m) ?? null}
              showTicks={showTicks?.(m)}
              maxWidth={maxWidth}
              onRetry={onRetry}
              onDecide={onDecide}
              onChip={onChip}
              onOrder={onOrder}
            />
          </View>
        </View>
      )
    },
    [messages, isMine, labelFor, showTicks, maxWidth, onRetry, onDecide, onChip, onOrder]
  )

  return (
    <View className="flex-1">
      <FlatList
        ref={list}
        inverted
        data={data}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={footer}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={20}
        windowSize={11}
      />
      {unseen > 0 ? (
        <View pointerEvents="box-none" className="absolute bottom-3 left-0 right-0 items-center">
          <Pressable accessibilityRole="button" onPress={() => toBottom(true)} className="flex-row items-center gap-1.5 rounded-full bg-primary-500 px-3 py-1.5 shadow-lg active:bg-primary-600">
            <ArrowDown size={14} color="#ffffff" />
            <Text className="text-xs font-semibold text-white">
              {unseen} new message{unseen === 1 ? '' : 's'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
