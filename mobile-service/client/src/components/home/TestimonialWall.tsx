import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Star } from 'lucide-react-native'
import { Carousel, GUTTER, SectionHeading } from './layout'
import { primary, useTokens } from '../../theme'
import type { SectionProps, Testimonial } from '../../types/home'

// Mirror of controller-service components/visitor/home/TestimonialWall.tsx.

function Stars({ rating }: { rating: number }) {
  const t = useTokens()
  return (
    <View className="flex-row gap-0.5" accessibilityLabel={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map(i =>
        // fill-amber-400 text-amber-400 (primary-400 is amber-400) / text-border-secondary
        i <= rating ? (
          <Star key={i} size={16} color={primary[400]} fill={primary[400]} />
        ) : (
          <Star key={i} size={16} color={t.borderSecondary} />
        )
      )}
    </View>
  )
}

function TestimonialCard({ t }: { t: Testimonial }) {
  const router = useRouter()
  return (
    <View className="flex-1 gap-3 rounded-2xl border border-border-default bg-surface-elevated p-5">
      <Stars rating={t.rating} />
      {t.title ? <Text className="text-base font-semibold text-foreground">{t.title}</Text> : null}
      <Text className="grow text-sm leading-relaxed text-foreground-secondary" numberOfLines={6}>
        “{t.comment}”
      </Text>
      <View className="border-t border-border-default pt-3">
        <Text className="text-xs">
          <Text className="font-semibold text-foreground">{t.author}</Text>
          {t.verified ? <Text className="text-accent-600 dark:text-accent-400">{'  '}Verified purchase</Text> : null}
        </Text>
        <Text
          onPress={() => router.push(`/product/${t.productSlug}`)}
          className="mt-1 text-xs text-foreground-muted"
          numberOfLines={1}
        >
          {t.productName}
        </Text>
      </View>
    </View>
  )
}

export default function TestimonialWall({ section, data }: SectionProps) {
  const items = (data.extras[section.id] as Testimonial[] | undefined) ?? []
  if (items.length === 0) return null
  const heading = section.copy.title ?? 'What our customers say'

  return (
    <View className="bg-surface-secondary py-12" style={{ paddingHorizontal: GUTTER }}>
      <SectionHeading
        eyebrow={section.copy.eyebrow ?? 'Customer reviews'}
        title={heading}
        eyebrowClassName="text-primary-500"
      />
      {section.layout === 'carousel' ? (
        <Carousel>
          {items.map(t => (
            <TestimonialCard key={t.id} t={t} />
          ))}
        </Carousel>
      ) : (
        <View className="gap-4">
          {items.map(t => (
            <TestimonialCard key={t.id} t={t} />
          ))}
        </View>
      )}
    </View>
  )
}
