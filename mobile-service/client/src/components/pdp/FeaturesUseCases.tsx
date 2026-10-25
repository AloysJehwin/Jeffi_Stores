import { View } from 'react-native'
import { Card, Overline, Text } from '../../ui'

// The AI-enriched "Features & Use Cases" card from the PDP page.tsx (single column at the mobile breakpoint).

function Bullets({ items }: { items: string[] }) {
  return (
    <View className="gap-1.5">
      {items.map((f, i) => (
        <View key={i} className="flex-row items-start gap-2">
          <View className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
          <Text className="flex-1 text-sm text-foreground">{f}</Text>
        </View>
      ))}
    </View>
  )
}

export default function FeaturesUseCases({ product }: { product: Record<string, any> }) {
  const features: string[] = Array.isArray(product.ai_features) ? product.ai_features : []
  const useCases: string[] = Array.isArray(product.ai_use_cases) ? product.ai_use_cases : []
  const whoUses: string | null = product.ai_who_uses_it || null
  const application: string | null = product.ai_application || null
  const hasFeatures = features.length > 0
  const hasUseCases = useCases.length > 0
  if (!hasFeatures && !hasUseCases && !whoUses && !application) return null

  return (
    <Card className="mb-6 p-5" padded={false}>
      <Text accessibilityRole="header" className="mb-5 font-display text-xl font-extrabold text-foreground">
        {'Features & Use Cases'}
      </Text>
      <View className="gap-6">
        {hasFeatures ? (
          <View>
            <Overline className="mb-2">Key Features</Overline>
            <Bullets items={features} />
          </View>
        ) : null}
        {hasUseCases ? (
          <>
            {hasFeatures ? <View className="border-t border-border-default" /> : null}
            <View>
              <Overline className="mb-2">Use Cases</Overline>
              <Bullets items={useCases} />
            </View>
          </>
        ) : null}
        {whoUses || application ? (
          <>
            {hasFeatures || hasUseCases ? <View className="border-t border-border-default" /> : null}
            <View className="gap-5">
              {whoUses ? (
                <View>
                  <Text className="mb-0.5 text-xs text-foreground-muted">Who Uses It</Text>
                  <Text className="text-sm font-semibold text-foreground">{whoUses}</Text>
                </View>
              ) : null}
              {application ? (
                <View>
                  <Text className="mb-0.5 text-xs text-foreground-muted">Application</Text>
                  <Text className="text-sm font-semibold text-foreground">{application}</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </Card>
  )
}
