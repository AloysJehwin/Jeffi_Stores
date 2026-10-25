import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, useMotion } from '../../ui'
import ProductCard from '../product/ProductCard'
import { Grid, SectionHeading } from './layout'
import type { SectionProps } from '../../types/home'

// Mirror of controller-service components/visitor/home/DealOfTheDay.tsx (+ DealCountdown).

const COPY = { eyebrow: 'Limited Time', title: 'Deal of the Day' }

const pad = (n: number) => String(n).padStart(2, '0')

export function DealCountdown({ endsAt }: { endsAt: string }) {
  const target = Date.parse(endsAt)
  const [ms, setMs] = useState<number | null>(null)
  // With reduced motion the seconds don't tick; the minutes update.
  const { animate } = useMotion()

  useEffect(() => {
    if (!Number.isFinite(target)) return
    const tick = () => setMs(Math.max(0, target - Date.now()))
    tick()
    const id = setInterval(tick, animate ? 1000 : 60_000)
    return () => clearInterval(id)
  }, [target, animate])

  if (ms == null || ms <= 0) return null

  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const parts = [
    ...(days > 0 ? [{ value: pad(days), label: 'Days' }] : []),
    { value: pad(Math.floor((total % 86400) / 3600)), label: 'Hrs' },
    { value: pad(Math.floor((total % 3600) / 60)), label: 'Min' },
    ...(animate ? [{ value: pad(total % 60), label: 'Sec' }] : []),
  ]
  const spoken = [days > 0 && `${days} days`, `${Math.floor((total % 86400) / 3600)} hours`, `${Math.floor((total % 3600) / 60)} minutes`].filter(Boolean).join(' ')

  return (
    <View className="flex-row items-center gap-1.5" accessible accessibilityRole="timer" accessibilityLabel={`Offer ends in ${spoken}`}>
      {parts.map(part => (
        <View key={part.label} className="min-w-[2.5rem] items-center rounded-lg bg-primary-500 px-2 py-1">
          <Text className="text-sm font-black leading-none text-white" style={{ fontVariant: ['tabular-nums'] }}>
            {part.value}
          </Text>
          <Text className="mt-0.5 text-[11px] font-bold uppercase leading-none text-white opacity-80" style={{ letterSpacing: 0.45 }}>
            {part.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

export default function DealOfTheDay({ section, data }: SectionProps) {
  const products = data.dealOfTheDay
  if (products.length === 0) return null
  const raw = section.config?.countdownEndsAt
  const endsAt = typeof raw === 'string' && Date.parse(raw) > Date.now() ? raw : null

  return (
    <View className="bg-surface-secondary px-4 py-12">
      <View className="mb-7 flex-row items-end justify-between gap-4">
        <SectionHeading
          eyebrow={section.copy.eyebrow ?? COPY.eyebrow}
          title={section.copy.title ?? COPY.title}
          eyebrowClassName="text-primary-500"
          barClassName="bg-primary-500"
          className="shrink"
        />
        {endsAt ? <DealCountdown endsAt={endsAt} /> : null}
      </View>

      <Grid cols={2} gap={12}>
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </Grid>
    </View>
  )
}
