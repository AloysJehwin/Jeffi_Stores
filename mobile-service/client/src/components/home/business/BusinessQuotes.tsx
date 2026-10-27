import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { FilePlus2, FileText } from 'lucide-react-native'
import { Badge, BodySmall, Button, ListGroup, ListRow, Overline, Text, TextButton } from '../../../ui'
import { Eyebrow } from '../layout'
import { RFQ_STATUS_SHORT, rfqTone } from '../../business/rfq'
import { dateFormat } from '../../../lib/format'
import { businessSettings, useBusinessHome } from './useBusinessHome'
import type { SectionProps } from '../../../types/home'

// A request-a-quote card (the cart's new-quote screen), then the business's open quotes.

const COPY = {
  eyebrow: 'Quotes',
  title: 'Buying in bulk?',
  subtitle: 'Send us your list and get a quote on business terms.',
  ctaLabel: 'Request a quote',
}

const submitted = dateFormat({ day: 'numeric', month: 'short' })

export default function BusinessQuotes({ section, data }: SectionProps) {
  const router = useRouter()
  const { copy } = section
  const { data: home } = useBusinessHome(section, data)
  const limit = businessSettings(section, data)?.limit || 3
  const quotes = home?.quotes
  const items = (quotes?.items ?? []).slice(0, limit)

  return (
    <View className="bg-surface px-4 py-12">
      <View className="gap-3 rounded-panel border border-accent-200 bg-accent-50 p-5 dark:border-accent-800 dark:bg-accent-900/20">
        <View>
          <Eyebrow>{copy.eyebrow ?? COPY.eyebrow}</Eyebrow>
          <Text accessibilityRole="header" className="font-display text-2xl font-extrabold leading-8 tracking-tight text-foreground">
            {copy.title || COPY.title}
          </Text>
        </View>
        <BodySmall>{copy.subtitle || COPY.subtitle}</BodySmall>
        <Button label={copy.ctaLabel || COPY.ctaLabel} icon={FilePlus2} size="sm" block={false} className="mt-1" onPress={() => router.push('/account/quotes/new')} />
      </View>

      {items.length > 0 && (
        <View className="mt-6">
          <View className="mb-2 flex-row items-center justify-between px-1">
            <Overline>Open quotes{quotes && quotes.open > 0 ? ` · ${quotes.open}` : ''}</Overline>
            <TextButton label="View all" onPress={() => router.push('/account/quotes')} />
          </View>
          <ListGroup>
            {items.map(q => (
              <ListRow
                key={q.id}
                icon={FileText}
                title={q.rfqNumber}
                subtitle={`${q.itemCount} item${q.itemCount !== 1 ? 's' : ''} · ${submitted(new Date(q.createdAt))}`}
                trailing={<Badge label={RFQ_STATUS_SHORT[q.status] ?? q.status} tone={rfqTone(q.status)} size="sm" />}
                onPress={() => router.push(`/account/quotes/${q.id}`)}
              />
            ))}
          </ListGroup>
        </View>
      )}
    </View>
  )
}
