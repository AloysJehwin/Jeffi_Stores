import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated'
import { ChevronRight, ClipboardList, Map as MapIcon, MapPin, MessageSquare, Receipt, SendHorizontal, User } from 'lucide-react-native'
import { Badge, BodySmall, Button, Caption, Card, Chip, ChipGroup, IconButton, statusTone, Subheading, Text, TextField, useMotion, type IconComponent } from '../../ui'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { showToast } from '../../stores/toastStore'
import { openHref } from '../../lib/links'
import { primary, useTokens } from '../../theme'
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

function OrderStatusBadge({ status }: { status: string }) {
  const label = status === 'granted' ? 'Access granted' : status.replace(/\b\w/g, c => c.toUpperCase())
  return <Badge size="sm" tone={statusTone(status)} label={label} />
}

const NAV_ICONS: Record<string, IconComponent> = { orders: ClipboardList, addresses: MapPin, invoices: Receipt, track: MapIcon }

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

function ActionButton({ action, onQuery }: { action: BotAction; onQuery: (q: string) => void }) {
  const router = useRouter()
  return <Chip size="sm" label={action.label} onPress={() => (action.query ? onQuery(action.query) : openHref(router, action.url))} />
}

const orderDate = (iso: string, year = false) =>
  new Date(iso).toLocaleDateString('en-IN', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })
const orderAmount = (n: string) => `₹${Number(n).toLocaleString('en-IN')}`

function OrderCard({ order, onPress }: { order: BotOrderCard; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="w-full rounded-field border border-border-default bg-surface px-3 py-2.5 active:bg-surface-secondary"
    >
      <View className="mb-1 flex-row items-center justify-between gap-2">
        <Text className="text-[13px] font-bold text-foreground">#{order.order_number}</Text>
        <OrderStatusBadge status={order.status} />
      </View>
      <Caption>
        {orderDate(order.created_at)} · {orderAmount(order.total_amount)}
      </Caption>
    </Pressable>
  )
}

function DetailRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View className="flex-row gap-3">
      <Caption className="flex-1">{label}</Caption>
      <Text numberOfLines={small ? 1 : undefined} className={small ? 'flex-1 text-[11px] font-medium text-foreground' : 'flex-1 text-xs font-medium capitalize text-foreground'}>
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
  const t = useTokens()
  const body = 'text-sm leading-relaxed text-foreground'

  if (payload.type === 'text') return <Text className={body}>{payload.text}</Text>

  if (payload.type === 'text_actions') {
    return (
      <View className="gap-2.5">
        <Text className={body}>{payload.text}</Text>
        <ChipGroup>
          {payload.actions.map((a, i) => (
            <ActionButton key={i} action={a} onQuery={onQuery} />
          ))}
        </ChipGroup>
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
        <View className="gap-2 rounded-field border border-border-default bg-surface px-3 py-2.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-bold text-foreground">#{o.order_number}</Text>
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
          <ChipGroup>
            {payload.actions.map((a, i) => (
              <ActionButton key={i} action={a} onQuery={onQuery} />
            ))}
          </ChipGroup>
        ) : null}
      </View>
    )
  }

  if (payload.type === 'nav') {
    return (
      <View className="gap-2">
        <Text className={body}>{payload.text}</Text>
        <View className="gap-1">
          {payload.links.map((link: BotNavLink, i) => {
            const Icon = NAV_ICONS[link.icon ?? ''] ?? User
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                onPress={() => (link.query ? onQuery(link.query) : openHref(router, link.url))}
                className="min-h-[44px] w-full flex-row items-center gap-2.5 rounded-field border border-border-default bg-surface px-3 py-2 active:bg-surface-secondary"
              >
                <Icon size={16} color={primary[500]} />
                <Text className="text-sm font-medium text-foreground">{link.label}</Text>
                <View className="ml-auto">
                  <ChevronRight size={14} color={t.foregroundMuted} />
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>
    )
  }

  if (payload.type === 'chips') {
    return (
      <View className="gap-2.5">
        <Text className={body}>{payload.text}</Text>
        <ChipGroup>
          {payload.chips.map((c, i) => (
            <Chip key={i} size="sm" label={c.label} onPress={() => onQuery(c.query)} />
          ))}
        </ChipGroup>
      </View>
    )
  }

  return null
}

/** Tailwind animate-bounce dot (translateY -25% ↔ 0, 1s), staggered. */
function BounceDot({ delay }: { delay: number }) {
  const y = useSharedValue(-1.5)
  const { animate } = useMotion()
  useEffect(() => {
    if (!animate) return
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
  }, [delay, y, animate])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-foreground-muted" style={style} />
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SupportChat() {
  const storeName = useStoreConfig().identity.name || 'Support'
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
            <Text className="mb-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400">{msg.sender_name || adminName || 'Support Agent'}</Text>
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
      <View className="shrink-0 flex-row items-center justify-between gap-3 border-b border-border-default px-4 py-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
            <MessageSquare size={18} color={primary[500]} />
          </View>
          <View className="flex-1">
            <Subheading numberOfLines={1} className="leading-5">
              {mode === 'bot' ? 'Jeffi' : adminName || 'Support Agent'}
            </Subheading>
            <Caption>{mode === 'bot' ? 'Support Assistant' : adminName ? `${storeName} Support` : 'Connecting...'}</Caption>
          </View>
        </View>
        {mode === 'live' && session ? <Button label="End Chat" variant="outline" size="sm" block={false} onPress={endChat} /> : null}
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
              <Button label="Connect to Support Agent" loadingLabel="Connecting..." loading={isConnecting} size="md" onPress={connectToAgent} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {mode === 'live' ? (
        <View className="shrink-0 border-t border-border-default px-4 pb-4 pt-2">
          <View className="flex-row items-center gap-2">
            <TextField
              containerClassName="flex-1"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={sendLiveMessage}
              submitBehavior="submit"
              returnKeyType="send"
              accessibilityLabel="Message"
              placeholder="Type a message..."
            />
            <IconButton icon={SendHorizontal} label="Send message" variant="solid" size="lg" disabled={isSending || !input.trim()} onPress={sendLiveMessage} />
          </View>
        </View>
      ) : null}

      {showEndSessionPrompt ? (
        <View className="absolute inset-0 z-10 justify-end bg-black/40 px-4 pb-6">
          <Card elevation="floating" padded={false} className="p-5">
            <Subheading className="mb-1">Session resolved</Subheading>
            <BodySmall className="mb-4">The support agent has marked your issue as resolved. Would you like to end this chat session?</BodySmall>
            <View className="flex-row gap-3">
              <Button label="End Chat" size="md" className="flex-1" onPress={endChat} />
              <Button label="Continue" variant="outline" size="md" className="flex-1" onPress={() => setShowEndSessionPrompt(false)} />
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  )
}
