import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, Zap } from 'lucide-react-native'
import { api } from '../../api/client'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useTokens } from '../../theme'

// The web's on-device AI panels as they run on a phone: the server (Ollama) fallback, rendered only once text arrives.
type Kind = 'cart' | 'recap' | 'affirmation'

const ROUTES: Record<Kind, string> = {
  cart: '/api/ai-cart-insight',
  recap: '/api/ai-recap',
  affirmation: '/api/ai-affirmation',
}

export default function AiInsight({ kind, body, className }: { kind: Kind; body: Record<string, unknown>; className?: string }) {
  const t = useTokens()
  const flags = useStoreConfig().flags as { aiStorefrontEnabled?: boolean; ondeviceSummaryEnabled?: boolean }
  const enabled = !!flags.aiStorefrontEnabled && !!flags.ondeviceSummaryEnabled
  const key = JSON.stringify(body)
  const { data: text } = useQuery({
    queryKey: ['ai-insight', kind, key],
    queryFn: async () => {
      const d = await api<{ text?: string }>(ROUTES[kind], { method: 'POST', body: key })
      return d?.text?.trim() || null
    },
    enabled,
    retry: false,
    staleTime: Infinity,
  })
  if (!enabled || !text) return null

  if (kind === 'recap') {
    return (
      <Card className={className}>
        <View className="mb-1.5 flex-row items-center gap-2">
          <Zap size={16} color={t.accent500} strokeWidth={2} />
          <Overline className="text-foreground-secondary">Your order at a glance</Overline>
          <Text className="ml-auto text-[11px] text-foreground-muted">AI summary</Text>
        </View>
        <Text className="text-sm leading-relaxed text-foreground">{text}</Text>
      </Card>
    )
  }

  const Icon = kind === 'affirmation' ? CircleCheck : Zap
  return (
    <Card padded={false} className={`flex-row items-start gap-2.5 px-4 py-3 ${className ?? ''}`}>
      <View className="mt-0.5">
        <Icon size={16} color={t.accent500} strokeWidth={2} />
      </View>
      <Text className="flex-1 text-sm leading-relaxed text-foreground">{text}</Text>
      <Text className="mt-0.5 text-[11px] text-foreground-muted">ollama</Text>
    </Card>
  )
}
