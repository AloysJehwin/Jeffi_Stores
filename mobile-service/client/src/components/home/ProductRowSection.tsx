import { View } from 'react-native'
import ProductCard from '../product/ProductCard'
import { Carousel, Grid, SectionHeading } from './layout'
import type { CardProduct } from '../../types/home'

// The web's ROW_STYLES: index 0/1/2 give the Featured / New Arrivals / Best Sellers looks.
export const ROW_STYLES = [
  { section: 'bg-surface-secondary', eyebrow: 'text-primary-500', bar: 'bg-primary-500', gap: 12 },
  { section: 'bg-surface', eyebrow: 'text-accent-500', bar: 'bg-accent-500', gap: 12 },
  { section: 'bg-surface-secondary', eyebrow: 'text-accent-500', bar: undefined, gap: 16 },
] as const

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
  style: (typeof ROW_STYLES)[number]
}) {
  // "View All" is hidden below sm on the web, so the mobile view has none.
  const cards = products.map(p => <ProductCard key={p.id} product={p} />)
  return (
    <View className={`px-4 py-12 ${style.section}`}>
      <SectionHeading eyebrow={eyebrow} title={title} eyebrowClassName={style.eyebrow} barClassName={style.bar} />
      {carousel ? <Carousel>{cards}</Carousel> : <Grid gap={style.gap}>{cards}</Grid>}
    </View>
  )
}
