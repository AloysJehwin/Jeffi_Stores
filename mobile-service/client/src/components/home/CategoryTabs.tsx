import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Button, Chip } from '../../ui'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import ProductCard from '../product/ProductCard'
import { Grid, SectionHeading } from './layout'
import { openHref } from '../../lib/links'
import { useTokens } from '../../theme'
import type { CategoryTab, SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/CategoryTabs.tsx.
export default function CategoryTabs({ section, data }: SectionProps) {
  const router = useRouter()
  const t = useTokens()
  const [active, setActive] = useState(0)
  const tabs = (data.extras[section.id] as CategoryTab[] | undefined) ?? []
  if (tabs.length === 0) return null
  const current = tabs[Math.min(active, tabs.length - 1)]

  return (
    <View className="bg-surface px-4 py-12">
      <View className="mb-6 gap-4">
        <SectionHeading eyebrow={section.copy.eyebrow} title={section.copy.title} className="" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -4 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingBottom: 4 }}
        >
          {tabs.map((tab, i) => (
            <Chip key={tab.id} label={tab.name} selected={tab.id === current.id} onPress={() => setActive(i)} />
          ))}
        </ScrollView>
      </View>

      <Grid cols={2} gap={12}>
        {current.products.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Grid>
      <View className="mt-7 flex-row justify-center">
        <Button
          label={`View all ${current.name}`}
          variant="ghost"
          size="sm"
          block={false}
          trailing={<ChevronRight size={16} color={t.accent600} strokeWidth={2} />}
          onPress={() => openHref(router, `/products?category=${encodeURIComponent(current.slug)}`)}
        />
      </View>
    </View>
  )
}
