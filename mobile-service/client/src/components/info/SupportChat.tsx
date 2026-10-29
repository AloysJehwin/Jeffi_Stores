import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { ArrowLeft, Bot, Headset, LogOut } from 'lucide-react-native'
import { Chip, IconButton, Spinner, Text, confirm, toast } from '../../ui'
import { primary, useTokens } from '../../theme'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { closeSupportSession, getOpenSupportSession, startSupportSession } from '../../api/info'
import { isActive, isSupportLanguage, type SupportMessage } from '../../types/support'
import Composer from '../chat/Composer'
import LanguagePicker from '../chat/LanguagePicker'
import MessageList from '../chat/MessageList'
import TypingIndicator from '../chat/TypingIndicator'
import { useSupportChat, type ReadyAttachment } from '../chat/useSupportChat'

// Mirror of controller-service components/visitor/SupportChat.tsx: the store's assistant answers first,
// and a person joins when needed. A full screen with its own header; the composer rides the keyboard.

const STARTERS = [
  { label: 'Where is my order?', text: 'Where is my order?' },
  { label: 'Cancel an order', text: 'I want to cancel an order' },
  { label: 'Return or refund', text: 'I want to return an item' },
  { label: 'Change delivery address', text: 'I need to change the delivery address on my order' },
  { label: 'Payment issue', text: 'I have a problem with a payment' },
  { label: 'Talk to a person', text: 'I would like to talk to a person' },
]

function deviceLang(): string | null {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale?.slice(0, 2)
    return isSupportLanguage(l) ? l : null
  } catch {
    return null
  }
}

export default function SupportChat() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const t = useTokens()
  const storeName = useStoreConfig().identity.name || 'Support'
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [starting, setStarting] = useState(false)
  const [focused, setFocused] = useState(true)
  const queued = useRef<{ text: string; attachments: ReadyAttachment[] } | null>(null)

  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )

  const chat = useSupportChat({ sessionId, focused })
  const s = chat.session

  useEffect(() => {
    getOpenSupportSession()
      .then(d => d.session?.id && setSessionId(d.session.id))
      .catch(() => {})
      .finally(() => setBooting(false))
  }, [])

  // The first message is typed before the chat exists: send it once the new chat has loaded.
  const { send } = chat
  useEffect(() => {
    if (!queued.current || !sessionId || chat.loading || s?.id !== sessionId) return
    const q = queued.current
    queued.current = null
    send(q.text, q.attachments)
  }, [sessionId, chat.loading, s?.id, send])

  const startingRef = useRef(false)
  const start = useCallback(async (first: string) => {
    if (startingRef.current) return
    startingRef.current = true
    setStarting(true)
    try {
      const d = await startSupportSession(deviceLang())
      if (!d.session?.id) throw new Error('Could not start the chat')
      queued.current = { text: first, attachments: [] }
      setSessionId(d.session.id)
    } catch (e) {
      toast.error(e instanceof Error && e.message !== 'Failed' ? e.message : 'Could not start the chat')
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [])

  const closed = s?.status === 'closed'
  const say = useCallback(
    (text: string, attachments: ReadyAttachment[] = []) => {
      if (!sessionId || closed) return void start(text)
      send(text, attachments)
    },
    [sessionId, closed, start, send]
  )

  const endChat = async () => {
    if (!sessionId) return
    const ok = await confirm({
      title: 'End this chat?',
      message: 'You can start a new one anytime. The conversation stays in your history.',
      confirmLabel: 'End chat',
      cancelLabel: 'Keep chatting',
    })
    if (!ok) return
    await closeSupportSession(sessionId).catch(() => {})
    chat.setSession(x => (x ? { ...x, status: 'closed' } : x))
  }

  const { decide: chatDecide } = chat
  const decide = useCallback(
    async (actionId: string, d: 'confirm' | 'decline') => {
      try {
        await chatDecide(actionId, d)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not do that')
      }
    },
    [chatDecide]
  )

  const human = s?.handler === 'human'
  const agentName = human ? s?.adminName : null
  const agentOnline = human && isActive(s?.adminLastSeenAt)
  const typingLabel = chat.typing ? (chat.typing.who === 'ai' ? 'Assistant is typing' : `${chat.typing.name || 'Agent'} is typing`) : null

  const isMine = useCallback((m: SupportMessage) => m.sender === 'customer', [])
  const labelFor = useCallback((m: SupportMessage) => (m.sender === 'customer' ? null : m.senderName || (m.sender === 'admin' ? 'Support' : 'Assistant')), [])
  const showTicks = useCallback((m: SupportMessage) => m.sender === 'customer' && m.channel !== 'whatsapp', [])
  const onOrder = useCallback((id: string) => router.push(`/orders/${id}`), [router])

  const title = agentName || (human ? `${storeName} Support` : `${storeName} Assistant`)
  const status = closed
    ? 'Chat ended'
    : typingLabel
      ? 'typing…'
      : human
        ? agentName
          ? agentOnline
            ? 'Online'
            : `${storeName} Support`
          : 'A support specialist will join shortly'
        : 'Replies instantly · a person can join anytime'

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  // A first message waiting for its new chat keeps the welcome up instead of flashing a spinner.
  const loading = booting || (!!sessionId && chat.loading && !queued.current)
  const empty = !loading && (!sessionId || chat.messages.length === 0)

  return (
    <View className="flex-1 bg-surface">
      <View style={{ paddingTop: insets.top }} className="border-b border-border-default bg-surface-elevated">
        <View className="h-14 flex-row items-center gap-1 px-2">
          <IconButton icon={ArrowLeft} label="Back" onPress={goBack} />
          <View className="mr-1 h-9 w-9 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
            {human ? <Headset size={18} color={primary[500]} /> : <Bot size={18} color={primary[500]} />}
            {agentOnline && !closed ? <View className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface-elevated bg-green-500" /> : null}
          </View>
          <View className="flex-1 pr-1">
            <Text accessibilityRole="header" numberOfLines={1} className="text-[15px] font-bold text-foreground">
              {title}
            </Text>
            <Text numberOfLines={1} className={typingLabel && !closed ? 'text-xs text-accent-600 dark:text-accent-400' : 'text-xs text-foreground-muted'}>
              {status}
              {s?.ticket ? ` · ${s.ticket}` : ''}
            </Text>
          </View>
          {sessionId && !closed ? <LanguagePicker value={s?.customerLang ?? deviceLang() ?? 'en'} onChange={chat.setLanguage} /> : null}
          {sessionId && !closed ? <IconButton icon={LogOut} label="End chat" color={t.foregroundSecondary} onPress={endChat} /> : null}
        </View>
      </View>
      {chat.error ? (
        <View className="border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-900/40 dark:bg-red-900/20">
          <Text className="text-xs text-red-700 dark:text-red-300">{chat.error}</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {loading ? (
          <Spinner label="Loading…" />
        ) : empty ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', padding: 16 }}>
            <View className="items-center gap-3 pb-2">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
                <Bot size={28} color={primary[500]} />
              </View>
              <View className="items-center">
                <Text className="text-base font-semibold text-foreground">Hi! How can we help?</Text>
                <Text className="mt-1 max-w-xs text-center text-[13px] leading-[18px] text-foreground-muted">
                  Our assistant can track, cancel or return orders, change a delivery address and answer questions right away. Ask for a person anytime.
                </Text>
              </View>
              <View className="mt-1 flex-row flex-wrap justify-center gap-2">
                {STARTERS.map(c => (
                  <Chip key={c.label} size="sm" label={c.label} disabled={starting} onPress={() => say(c.text)} />
                ))}
              </View>
            </View>
          </ScrollView>
        ) : (
          <MessageList
            messages={chat.messages}
            isMine={isMine}
            labelFor={labelFor}
            showTicks={showTicks}
            onRetry={chat.retry}
            onDecide={decide}
            onChip={say}
            onOrder={onOrder}
            footer={
              typingLabel || closed ? (
                <View>
                  {typingLabel ? <TypingIndicator label={typingLabel} /> : null}
                  {closed ? <Text className="py-3 text-center text-[11px] text-foreground-muted">This chat has ended. Write below to start a new one.</Text> : null}
                </View>
              ) : null
            }
          />
        )}
        <Composer
          onSend={say}
          upload={sessionId && !closed ? chat.upload : undefined}
          onTyping={sessionId && !closed ? chat.notifyTyping : undefined}
          disabled={booting || starting}
          placeholder={closed ? 'Start a new chat…' : 'Type your message'}
        />
      </KeyboardAvoidingView>
    </View>
  )
}
