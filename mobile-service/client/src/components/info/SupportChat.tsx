import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Text } from '../../ui'
import { useRouter } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated'
import { Glyph, CHAT, CHEVRON_RIGHT } from './Glyph'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { showToast } from '../../stores/toastStore'
import { openHref } from '../../lib/links'
import { useTokens } from '../../theme'
import {
  askBot, closeSession, getOpenSession, getSessionMessages, sendSessionMessage, startSession,
  type BotAction, type BotNavLink, type BotOrderCard, type BotPayload, type SupportMessage, type SupportSession,
} from '../../api/info'

// Mirror of controller-service components/visitor/SupportChat.tsx.

type Message = SupportMessage & { payload?: BotPayload }

const QUICK_REPLIES = [
  { label: 'Track my order', query: 'track my order' },
  { label: 'My orders', query: 'all my orders' },
  { label: 'Cancel order', query: 'cancel an order' },
  { label: 'Return / Refund', query: 'return an order' },
  { label: 'Payment status', query: 'payment status' },
  { label: 'Latest order', query: 'latest order' },
]

const SHADOW_2XL = '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
const SEND = 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8'

function parsePayload(message: string): BotPayload | null {
  try {
    const p = JSON.parse(message)
    return p && typeof p.type === 'string' ? (p as BotPayload) : null
  } catch {
    return null
  }
}

function attachPayloads(msgs: SupportMessage[]): Message[] {
  return msgs.map(m => (m.sender === 'bot' || m.sender === 'admin' ? { ...m, payload: parsePayload(m.message) ?? undefined } : { ...m }))
}

const botMsg = (id: string, payload: BotPayload): Message => ({ id, sender: 'bot', message: '', payload })

// ─── Sub-renderers ──────────────────────────────────────────────────────────

const BADGE: Record<string, { box: string; text: string }> = {
  pending: { box: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-800 dark:text-yellow-300' },
  confirmed: { box: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300' },
  processing: { box: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-300' },
  shipped: { box: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-800 dark:text-purple-300' },
  dispatched: { box: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-800 dark:text-purple-300' },
  delivered: { box: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-800 dark:text-green-300' },
  granted: { box: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-800 dark:text-green-300' },
  cancelled: { box: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-800 dark:text-red-300' },
  returned: { box: 'bg-gray-100 dark:bg-gray-700/40', text: 'text-gray-700 dark:text-gray-300' },
}
const BADGE_DEFAULT = { box: 'bg-gray-100', text: 'text-gray-700' }

function OrderStatusBadge({ status }: { status: string }) {
  const c = BADGE[status] ?? BADGE_DEFAULT
  return (
    <View className={`rounded px-1.5 py-0.5 ${c.box}`}>
      <Text className={`text-[10px] font-semibold capitalize ${c.text}`}>{status === 'granted' ? 'Access granted' : status}</Text>
    </View>
  )
}

const NAV_ICONS: Record<string, string | string[]> = {
  orders:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  addresses: [
    'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    'M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  invoices: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  track:
    'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
}
const NAV_DEFAULT = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'

/** Renders text with http(s) URLs as tappable links (web: renderTextWithLinks). */
function Linkified({ text, className }: { text: string; className: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <Text className={className}>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return part
        const m = part.match(/^(.*?)([.,!?)]*)$/)
        const url = m ? m[1] : part
        return (
          <Text key={i}>
            <Text className="text-accent-600 underline dark:text-accent-400" onPress={() => Linking.openURL(url)}>
              {url}
            </Text>
            {m ? m[2] : ''}
          </Text>
        )
      })}
    </Text>
  )
}

const PILL = 'border border-primary-300 bg-primary-50 active:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/20 dark:active:bg-primary-900/40'
const PILL_TEXT = 'text-xs font-medium text-primary-600 dark:text-primary-400'

function ActionButton({ action, onQuery }: { action: BotAction; onQuery: (q: string) => void }) {
  const router = useRouter()
  return (
    <Pressable
      className={`rounded-lg px-2.5 py-1 ${PILL}`}
      onPress={() => (action.query ? onQuery(action.query) : openHref(router, action.url))}
    >
      <Text className={PILL_TEXT}>{action.label}</Text>
    </Pressable>
  )
}

const orderDate = (iso: string, year = false) =>
  new Date(iso).toLocaleDateString('en-IN', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })
const orderAmount = (n: string) => `₹${Number(n).toLocaleString('en-IN')}`

function OrderCard({ order, onPress }: { order: BotOrderCard; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 active:bg-surface-elevated">
      <View className="mb-1 flex-row items-center justify-between gap-2">
        <Text className="text-xs font-bold text-foreground">#{order.order_number}</Text>
        <OrderStatusBadge status={order.status} />
      </View>
      <Text className="text-xs text-foreground-muted">
        {orderDate(order.created_at)} · {orderAmount(order.total_amount)}
      </Text>
    </Pressable>
  )
}

function DetailRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View className="flex-row gap-3">
      <Text className="flex-1 text-xs text-foreground-muted">{label}</Text>
      <Text numberOfLines={small ? 1 : undefined} className={small ? 'flex-1 text-[10px] font-medium text-foreground' : 'flex-1 text-xs font-medium capitalize text-foreground'}>
        {value}
      </Text>
    </View>
  )
}

function PayloadRenderer({
  payload,
  onQuery,
  onOrderSelect,
}: {
  payload: BotPayload
  onQuery: (q: string) => void
  onOrderSelect: (order: BotOrderCard, context: string) => void
}) {
  const router = useRouter()
  const body = 'text-sm leading-relaxed text-foreground'

  if (payload.type === 'text') return <Text className={body}>{payload.text}</Text>

  if (payload.type === 'text_actions') {
    return (
      <View className="gap-2.5">
        <Text className={body}>{payload.text}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {payload.actions.map((a, i) => (
            <ActionButton key={i} action={a} onQuery={onQuery} />
          ))}
        </View>
      </View>
    )
  }

  if (payload.type === 'order_list') {
    return (
      <View className="gap-2">
        <Text className={body}>{payload.text}</Text>
        <View className="gap-1.5">
          {payload.orders.map(o => (
            <OrderCard key={o.order_number} order={o} onPress={() => onOrderSelect(o, payload.context)} />
          ))}
        </View>
      </View>
    )
  }

  if (payload.type === 'order_detail') {
    const o = payload.order
    return (
      <View className="gap-2.5">
        <View className="gap-2 rounded-xl border border-border-default bg-surface px-3 py-2.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold text-foreground">#{o.order_number}</Text>
            <OrderStatusBadge status={o.status} />
          </View>
          <View className="gap-1">
            <DetailRow label="Date" value={orderDate(o.created_at, true)} />
            <DetailRow label="Total" value={orderAmount(o.total_amount)} />
            <DetailRow label="Payment" value={o.payment_status} />
            {o.tracking_number ? <DetailRow label="Tracking" value={o.tracking_number} small /> : null}
          </View>
        </View>
        {payload.actions.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5">
            {payload.actions.map((a, i) => (
              <ActionButton key={i} action={a} onQuery={onQuery} />
            ))}
          </View>
        ) : null}
      </View>
    )
  }

  if (payload.type === 'nav') {
    return (
      <View className="gap-2">
        <Text className={body}>{payload.text}</Text>
        <View className="gap-1">
          {payload.links.map((link: BotNavLink, i) => (
            <Pressable
              key={i}
              onPress={() => (link.query ? onQuery(link.query) : openHref(router, link.url))}
              className="w-full flex-row items-center gap-2.5 rounded-lg border border-border-default bg-surface px-3 py-2 active:bg-surface-elevated"
            >
              <Glyph d={NAV_ICONS[link.icon ?? ''] ?? NAV_DEFAULT} size={16} className="text-primary-500" />
              <Text className="text-sm font-medium text-foreground">{link.label}</Text>
              <View className="ml-auto">
                <Glyph d={CHEVRON_RIGHT} size={14} className="text-foreground-muted" />
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    )
  }

  if (payload.type === 'chips') {
    return (
      <View className="gap-2.5">
        <Text className={body}>{payload.text}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {payload.chips.map((c, i) => (
            <Pressable key={i} onPress={() => onQuery(c.query)} className={`rounded-full px-3 py-1.5 ${PILL}`}>
              <Text className={PILL_TEXT}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    )
  }

  return null
}

/** Tailwind animate-bounce dot (translateY -25% ↔ 0, 1s), staggered. */
function BounceDot({ delay }: { delay: number }) {
  const y = useSharedValue(-1.5)
  useEffect(() => {
    y.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0, { duration: 500, easing: Easing.bezier(0, 0, 0.2, 1) }),
          withTiming(-1.5, { duration: 500, easing: Easing.bezier(0.8, 0, 1, 1) })
        ),
        -1
      )
    )
  }, [delay, y])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-foreground-muted" style={style} />
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SupportChat() {
  const storeName = useStoreConfig().identity.name || 'Support'
  const t = useTokens()
  const [mode, setMode] = useState<'bot' | 'live'>('bot')
  const [messages, setMessages] = useState<Message[]>([
    botMsg('welcome', {
      type: 'chips',
      text: "hey! i'm Jeffi, your support assistant. what can i help you with?",
      chips: QUICK_REPLIES.map(qr => ({ label: qr.label, query: qr.query })),
    }),
  ])
  const [input, setInput] = useState('')
  const [session, setSession] = useState<SupportSession | null>(null)
  const [adminName, setAdminName] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [showConnectPrompt, setShowConnectPrompt] = useState(false)
  const [showEndSessionPrompt, setShowEndSessionPrompt] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const lastMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    resumeSession()
  }, [])

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(id)
  }, [messages, showConnectPrompt, isSending])

  useEffect(() => {
    if (mode !== 'live' || !session) return
    const id = setInterval(() => pollMessages(session.id), 3000)
    return () => clearInterval(id)
  }, [mode, session])

  async function resumeSession() {
    try {
      const data = await getOpenSession()
      if (!data.session) return
      const msgsData = await getSessionMessages(data.session.id)
      if (!msgsData.messages?.length) {
        await closeSession(data.session.id).catch(() => {})
        return
      }
      setSession(data.session)
      if (data.session.admin_name) setAdminName(data.session.admin_name)
      setMode('live')
      setMessages(attachPayloads(msgsData.messages))
      lastMessageIdRef.current = msgsData.messages[msgsData.messages.length - 1].id
      if (msgsData.admin_name) setAdminName(msgsData.admin_name)
    } catch {}
  }

  async function pollMessages(sessionId: string) {
    try {
      const data = await getSessionMessages(sessionId)
      if (!data.messages?.length) return
      const latest = data.messages[data.messages.length - 1]
      if (latest.id !== lastMessageIdRef.current) {
        lastMessageIdRef.current = latest.id
        setMessages(attachPayloads(data.messages))
        if (data.admin_name) setAdminName(data.admin_name)
        if (latest.is_closing && latest.sender === 'admin') setShowEndSessionPrompt(true)
      }
    } catch {}
  }

  async function handleBotQuery(query: string) {
    if (isSending) return
    if (query === '__connect_agent__') {
      connectToAgent()
      return
    }
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', message: query }])
    setIsSending(true)
    try {
      // Never render a raw server `error` string to the customer; a network failure falls to the retry below.
      const fallback: BotPayload = {
        type: 'text',
        text: "i'm having trouble with that right now — please try again or connect to a support agent.",
      }
      const payload = await askBot(query).then(
        d => d.payload ?? fallback,
        (e: unknown) => {
          if (e instanceof TypeError) throw e
          return fallback
        }
      )
      setMessages(prev => [...prev, botMsg(Date.now().toString() + 'b', payload)])
      setShowConnectPrompt(true)
    } catch {
      setMessages(prev => [
        ...prev,
        botMsg(Date.now().toString() + 'b', {
          type: 'text_actions',
          text: 'Something went wrong. Please try again.',
          actions: [{ label: 'Try Again', query }],
        }),
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function connectToAgent() {
    setIsConnecting(true)
    try {
      const data = await startSession()
      setSession(data.session)
      setMode('live')
      setShowConnectPrompt(false)
      setMessages([
        botMsg('live-start', {
          type: 'text',
          text: "you're now in the support queue — an agent will join shortly. feel free to describe your issue while you wait.",
        }),
      ])
      lastMessageIdRef.current = null
      showToast('Support agent notified. We will respond shortly.', 'success')
    } catch (err: any) {
      if (err?.message === 'Unauthorized') showToast('Please sign in to connect to a support agent.', 'error')
      else showToast(err?.message || 'Failed to connect. Please try again.', 'error')
    } finally {
      setIsConnecting(false)
    }
  }

  async function sendLiveMessage() {
    if (!input.trim() || isSending || !session) return
    const text = input.trim()
    setInput('')
    setIsSending(true)
    try {
      const data = await sendSessionMessage(session.id, text)
      setMessages(prev => [...prev, { ...data.message }])
      lastMessageIdRef.current = data.message.id
    } catch {
      showToast('Failed to send message.', 'error')
    } finally {
      setIsSending(false)
    }
  }

  async function endChat() {
    if (!session) return
    await closeSession(session.id).catch(() => {})
    setSession(null)
    setAdminName(null)
    setMode('bot')
    setShowConnectPrompt(false)
    setShowEndSessionPrompt(false)
    setMessages([
      botMsg('end', {
        type: 'chips',
        text: 'chat ended. need more help?',
        chips: QUICK_REPLIES.map(qr => ({ label: qr.label, query: qr.query })),
      }),
    ])
    lastMessageIdRef.current = null
  }

  function handleOrderSelect(order: BotOrderCard, context: string) {
    const contextMessages: Record<string, string> = {
      cancel: `i want to cancel order #${order.order_number}`,
      return: `i want to return order #${order.order_number}`,
      track: `track order #${order.order_number}`,
      payment: `payment details for order #${order.order_number}`,
      view: `details for order #${order.order_number}`,
    }
    handleBotQuery(contextMessages[context] ?? `order #${order.order_number}`)
  }

  function renderMessage(msg: Message) {
    if (msg.sender === 'user') {
      return (
        <View key={msg.id} className="flex-row justify-end">
          <View className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-500 px-3.5 py-2.5">
            <Linkified text={msg.message} className="text-sm leading-relaxed text-white" />
          </View>
        </View>
      )
    }
    const payload = msg.payload ?? (msg.message ? parsePayload(msg.message) : null)
    return (
      <View key={msg.id} className="flex-row justify-start">
        <View className="max-w-[90%] rounded-2xl rounded-bl-sm border border-border-default bg-surface px-3.5 py-2.5">
          {msg.sender === 'admin' ? (
            <Text className="mb-1.5 text-xs font-semibold text-primary-500">{msg.sender_name || adminName || 'Support Agent'}</Text>
          ) : null}
          {payload ? (
            <PayloadRenderer payload={payload} onQuery={handleBotQuery} onOrderSelect={handleOrderSelect} />
          ) : (
            <Linkified text={msg.message ?? ''} className="text-sm leading-relaxed text-foreground" />
          )}
        </View>
      </View>
    )
  }

  return (
    <View className="relative h-full w-full overflow-hidden bg-surface-elevated">
      <View className="shrink-0 flex-row items-center justify-between bg-primary-500 px-4 py-3">
        <View className="flex-row items-center gap-2.5">
          <View className="h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <Glyph d={CHAT} size={16} className="text-white" />
          </View>
          <View>
            <Text className="text-sm font-semibold leading-none text-white">{mode === 'bot' ? 'Jeffi' : adminName || 'Support Agent'}</Text>
            <Text className="mt-0.5 text-xs text-white/70">
              {mode === 'bot' ? 'Support Assistant' : adminName ? `${storeName} Support` : 'Connecting...'}
            </Text>
          </View>
        </View>
        {mode === 'live' && session ? (
          <Pressable onPress={endChat} className="rounded-lg border border-white/30 px-3 py-1.5 active:bg-white/10">
            <Text className="text-xs text-white/80">End Chat</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView ref={scrollRef} nestedScrollEnabled className="flex-1" contentContainerClassName="gap-3 px-4 py-4" keyboardShouldPersistTaps="handled">
        {messages.map(renderMessage)}

        {isSending && mode === 'bot' ? (
          <View className="flex-row justify-start">
            <View className="flex-row items-center gap-1 rounded-2xl rounded-bl-sm border border-border-default bg-surface px-3.5 py-2.5">
              <BounceDot delay={0} />
              <BounceDot delay={150} />
              <BounceDot delay={300} />
            </View>
          </View>
        ) : null}

        {mode === 'bot' && showConnectPrompt && !isSending ? (
          <View className="flex-row justify-start pt-1">
            <View className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border-default bg-surface px-3.5 py-3">
              <Text className="mb-3 text-sm text-foreground">
                Still need help? Connect to a live support agent and we&apos;ll assist you directly.
              </Text>
              <Pressable
                onPress={connectToAgent}
                disabled={isConnecting}
                className={`w-full items-center rounded-lg bg-primary-500 py-2 active:bg-primary-600 ${isConnecting ? 'opacity-50' : ''}`}
              >
                <Text className="text-sm font-semibold text-white">{isConnecting ? 'Connecting...' : 'Connect to Support Agent'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {mode === 'live' ? (
        <View className="shrink-0 border-t border-border-default px-4 pb-4 pt-2">
          <View className="flex-row gap-2">
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={sendLiveMessage}
              submitBehavior="submit"
              returnKeyType="send"
              placeholder="Type a message..."
              placeholderTextColor={t.foregroundMuted}
              className="flex-1 rounded-xl border border-border-default bg-surface px-3.5 py-2.5 text-sm text-foreground"
            />
            <Pressable
              onPress={sendLiveMessage}
              disabled={isSending || !input.trim()}
              className={`items-center justify-center rounded-xl bg-primary-500 px-4 py-2.5 active:bg-primary-600 ${isSending || !input.trim() ? 'opacity-50' : ''}`}
            >
              <Glyph d={SEND} size={16} className="text-white" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {showEndSessionPrompt ? (
        <View className="absolute inset-0 z-10 justify-end bg-black/40 px-4 pb-6">
          <View className="rounded-2xl bg-surface-elevated p-5" style={{ boxShadow: SHADOW_2XL }}>
            <Text className="mb-1 text-sm font-semibold text-foreground">Session resolved</Text>
            <Text className="mb-4 text-sm text-foreground-muted">
              The support agent has marked your issue as resolved. Would you like to end this chat session?
            </Text>
            <View className="flex-row gap-3">
              <Pressable onPress={endChat} className="flex-1 items-center rounded-xl bg-primary-500 py-2 active:bg-primary-600">
                <Text className="text-sm font-semibold text-white">End Chat</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowEndSessionPrompt(false)}
                className="flex-1 items-center rounded-xl border border-border-default py-2 active:bg-surface-secondary"
              >
                <Text className="text-sm font-semibold text-foreground-secondary">Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
