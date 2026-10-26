import { memo } from 'react'
import { View } from 'react-native'
import { Rail } from '../../ui'
import ProductCard from '../product/ProductCard'
import { Grid, SectionHeading, useColumnWidth } from './layout'
import type { CardProduct } from '../../types/home'

// The web's ROW_STYLES: index 0/1/2 give the Featured / New Arrivals / Best Sellers looks.
export const ROW_STYLES = [
  { section: 'bg-surface-secondary', eyebrow: 'text-primary-500', bar: 'bg-primary-500', gap: 12 },
  { section: 'bg-surface', eyebrow: 'text-accent-500', bar: 'bg-accent-500', gap: 12 },
  { section: 'bg-surface-secondary', eyebrow: 'text-accent-500', bar: undefined, gap: 16 },
] as const

export type RowStyle = (typeof ROW_STYLES)[number]

export default function ProductRowSection({
  title,
  eyebrow,
  products,
  carousel,
  style,
}: {
  title: string
  eyebrow: string
  products: CardProduct[]
  carousel: boolean
  style: RowStyle
}) {
  // "View All" is hidden below sm on the web, so the mobile view has none.
  const cards = products.map(p => <ProductCard key={p.id} product={p} />)
  return (
    <View className={`px-4 py-12 ${style.section}`}>
      <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName={style.eyebrow} barClassName={style.bar} />
      {carousel ? <Rail>{cards}</Rail> : <Grid gap={style.gap}>{cards}</Grid>}
    </View>
  )
}

// The home feed's split form of a grid row (SectionRenderer feedItems): the heading, then a row of two per item.

export function ProductRowHead({ title, eyebrow, style }: { title: string; eyebrow: string; style: RowStyle }) {
  return (
    <View className={`px-4 pt-12 ${style.section}`}>
      <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName={style.eyebrow} barClassName={style.bar} />
    </View>
  )
}

/** One row of a two-column card grid; `last` closes the section's bottom padding (py-12). */
export const ProductPair = memo(function ProductPair({ products, bg, gap, last }: { products: CardProduct[]; bg: string; gap: number; last: boolean }) {
  const w = useColumnWidth(2, gap)
  return (
    <View className={`flex-row px-4 ${bg}`} style={{ gap, paddingBottom: last ? 48 : gap }}>
      {products.map(p => (
        <View key={p.id} style={{ width: w }}>
          <ProductCard product={p} />
        </View>
      ))}
    </View>
  )
})
