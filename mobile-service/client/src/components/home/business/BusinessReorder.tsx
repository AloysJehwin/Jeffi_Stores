import ProductRowSection, { type RowStyle } from '../ProductRowSection'
import { businessSettings, useBusinessHome } from './useBusinessHome'
import type { SectionProps } from '../../../types/home'

// The business's most-ordered products, as a product row; hidden until it has ordered something.

const COPY = { eyebrow: 'Buy again', title: 'Reorder your regulars' }

export default function BusinessReorder({ section, data, style }: SectionProps & { style: RowStyle }) {
  const { data: home } = useBusinessHome(section, data)
  const limit = businessSettings(section, data)?.limit
  const products = (home?.reorder ?? []).slice(0, limit || undefined)
  if (products.length === 0) return null
  return (
    <ProductRowSection
      title={section.copy.title || COPY.title}
      eyebrow={section.copy.eyebrow ?? COPY.eyebrow}
      products={products}
      carousel={section.layout === 'carousel'}
      style={style}
      aspect={section.aspect}
    />
  )
}
